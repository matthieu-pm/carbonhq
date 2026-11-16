use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use carbon_proto::{DiscoveryData, DiscoveryRequest, EffectiveConfiguration, HarnessInfo};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::hash::{DefaultHasher, Hash, Hasher};

/// Discovery runs on the owning server and uses the same sources as its composer.
pub(super) async fn request(request: DiscoveryRequest, app: &Sink) -> Result<Response> {
    let data = match request {
        DiscoveryRequest::Harnesses => DiscoveryData::Harnesses {
            harnesses: crate::agent_availability()
                .await
                .into_iter()
                .map(info)
                .collect(),
        },
        DiscoveryRequest::Harness { harness } => {
            let (harness, availability) = target(&harness).await?;
            let acp = matches!(harness, Harness::Acp(_));
            let options = crate::agent_options(harness, None).await;
            let modes = if acp {
                serde_json::to_value(crate::agent_modes(harness, None).await)?
            } else {
                json!({
                    "modes": harness.controls().modes.iter().map(|mode| json!({"id": mode.as_arg(), "name": mode.as_arg()})).collect::<Vec<_>>(),
                    "inheritedModes": harness.controls().inherited_modes,
                    "reasons": harness.controls().reasons,
                })
            };
            let options_source = if !acp {
                "carbon"
            } else if crate::harness::agents::has_learned_options(harness) {
                "last_reported"
            } else {
                "not_yet_reported"
            };
            let default_model = if availability.available {
                let model = resolve_model(None, None, harness).await?;
                model_arg(harness, &model).await
            } else {
                None
            };
            DiscoveryData::Harness {
                harness: info(availability),
                capabilities: serde_json::to_value(harness.caps())?,
                live_controls: harness.controls().live.clone(),
                modes,
                options: options
                    .into_iter()
                    .map(|mut option| {
                        let models = option.category.as_deref() == Some("model");
                        let total = option.options.len();
                        if models {
                            option.options.clear();
                        }
                        let mut value = serde_json::to_value(&option)?;
                        if models {
                            value["valuesSource"] = json!("model ls");
                            value["total"] = json!(total);
                        }
                        Ok(value)
                    })
                    .collect::<Result<_>>()?,
                options_source: options_source.into(),
                default_model,
            }
        }
        DiscoveryRequest::Models {
            harness,
            query,
            limit,
            cursor,
        } => {
            anyhow::ensure!(
                (1..=100).contains(&limit),
                "--limit must be between 1 and 100"
            );
            anyhow::ensure!(
                query.as_ref().is_none_or(|q| q.len() <= 256),
                "--query must be at most 256 bytes"
            );
            let (harness, availability) = target(&harness).await?;
            let models = if availability.available {
                crate::list_models(app.clone(), Some(harness)).await
            } else {
                vec![]
            };
            let reason = if !availability.available {
                Some(availability.reason.clone())
            } else if models.is_empty() {
                Some(if matches!(harness, Harness::Acp(_)) {
                    "This agent has not reported any models. Discovery does not open an ACP session.".into()
                } else {
                    "The harness reported no models. Check its provider configuration and login."
                        .into()
                })
            } else {
                None
            };
            let (models, total, next_cursor) =
                page(models, &harness.wire_name(), query, limit, cursor)?;
            DiscoveryData::Models {
                harness: info(availability),
                models,
                total,
                next_cursor,
                catalog_reason: reason,
            }
        }
    };
    Ok(Response::Discovery { data })
}

fn info(availability: crate::AgentAvailability) -> HarnessInfo {
    HarnessInfo {
        harness: availability.harness.wire_name(),
        label: availability.label,
        available: availability.available,
        reason: (!availability.available).then_some(availability.reason),
        install_command: availability.install_command,
        docs_url: availability.docs_url,
        login_command: availability.login_command,
        login_hint: availability.login_hint,
    }
}

/// Validate the named harness before probing its models.
async fn target(name: &str) -> Result<(Harness, crate::AgentAvailability)> {
    let harness: Harness = serde_json::from_value(json!(name))?;
    let availability = crate::agent_availability_for(harness)
        .await
        .with_context(|| {
            format!("unknown or disabled harness {name:?} — run `carbon harness ls`")
        })?;
    Ok((harness, availability))
}

/// A receipt value must work as --model, including models whose persisted IDs differ.
async fn model_arg(harness: Harness, id: &ModelId) -> Option<String> {
    if id.is_unset() {
        return None;
    }
    let model = match harness {
        Harness::ClaudeCode | Harness::Codex => crate::models::find_model(id),
        Harness::Pi => crate::harness::pi::models::find(id).await,
        Harness::Fx => crate::harness::fx::models::find(id).await,
        Harness::Grok => crate::harness::grok::models::find(id).await,
        Harness::Acp(_) => crate::harness::agents::find_model(harness, id),
        Harness::Other(_) => None,
    };
    Some(
        model
            .map(|model| model.arg)
            .unwrap_or_else(|| id.to_string()),
    )
}

#[derive(Serialize, Deserialize)]
struct Cursor {
    harness: String,
    query: String,
    offset: usize,
    fingerprint: u64,
}

/// Cursors bind to the query and catalog so a changed probe cannot silently skip rows.
fn page(
    models: Vec<crate::models::Model>,
    harness: &str,
    query: Option<String>,
    limit: u32,
    cursor: Option<String>,
) -> Result<(Vec<Value>, usize, Option<String>)> {
    let query = query.unwrap_or_default().trim().to_lowercase();
    let models: Vec<_> = models
        .into_iter()
        .filter(|m| {
            [&m.label, &m.arg, &m.provider, &m.id.to_string()]
                .iter()
                .any(|s| s.to_lowercase().contains(&query))
        })
        .collect();
    let mut hash = DefaultHasher::new();
    serde_json::to_string(&models)?.hash(&mut hash);
    let fingerprint = hash.finish();
    let offset = match cursor {
        None => 0,
        Some(cursor) => {
            anyhow::ensure!(cursor.len() <= 2048, "invalid model cursor");
            let parsed: Cursor = serde_json::from_slice(
                &URL_SAFE_NO_PAD
                    .decode(cursor)
                    .context("invalid model cursor")?,
            )
            .context("invalid model cursor")?;
            anyhow::ensure!(
                parsed.harness == harness
                    && parsed.query == query
                    && parsed.fingerprint == fingerprint
                    && parsed.offset <= models.len(),
                "model cursor no longer matches this catalog or query — restart without --cursor"
            );
            parsed.offset
        }
    };
    let total = models.len();
    let end = offset.saturating_add(limit as usize).min(total);
    let next = (end < total).then(|| {
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&Cursor {
                harness: harness.into(),
                query,
                offset: end,
                fingerprint,
            })
            .expect("serializable cursor"),
        )
    });
    Ok((
        models[offset..end]
            .iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<_, _>>()?,
        total,
        next,
    ))
}

/// Use the post-send snapshot, after defaults, acknowledgements and fast/effort clamping.
pub(super) async fn configuration(item: &SessionIndexItem) -> EffectiveConfiguration {
    let acp = matches!(item.harness, Harness::Acp(_));
    EffectiveConfiguration {
        harness: item.harness.wire_name(),
        model: model_arg(item.harness, &item.model).await,
        effort: if acp {
            crate::harness::agents::saved_options(item)
                .into_iter()
                .find(|option| option.category.as_deref() == Some("thought_level"))
                .and_then(|option| option.current_value)
        } else {
            item.effort.map(|effort| effort.as_arg().into())
        },
        mode: if acp {
            item.agent_mode.clone()
        } else {
            let policy = item.harness.controls();
            let mode = if policy.inherited_modes.contains(&item.permission_mode) {
                item.permission_mode
            } else {
                policy
                    .fallbacks
                    .get(&item.permission_mode)
                    .copied()
                    .unwrap_or(item.permission_mode)
            };
            Some(mode.as_arg().into())
        },
        fast: item.fast,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Effort, Model, ModelId};

    fn models() -> Vec<Model> {
        (0..235)
            .map(|n| Model {
                id: ModelId::new(format!("vendor/model-{n:03}")),
                label: format!("Model {n:03}"),
                arg: format!("vendor/model-{n:03}"),
                efforts: vec![Effort::Low, Effort::High],
                default_effort: Some(Effort::High),
                provider: "Vendor".into(),
                accepts_images: true,
                supports_fast: n % 2 == 0,
                secondary: false,
            })
            .collect()
    }

    #[test]
    fn a_large_catalog_is_complete_across_bounded_pages() {
        let mut cursor = None;
        let mut ids = vec![];
        loop {
            let (page, total, next) = page(models(), "pi", None, 50, cursor).unwrap();
            assert_eq!(total, 235);
            assert!(page.len() <= 50);
            ids.extend(
                page.into_iter()
                    .map(|m| m["id"].as_str().unwrap().to_owned()),
            );
            cursor = next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 235);
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 235);
    }

    #[test]
    fn search_matches_alias_label_and_provider_and_cursors_reject_drift() {
        for query in ["VENDOR", "model-", "Model "] {
            let (_, total, _) = page(models(), "pi", Some(query.into()), 50, None).unwrap();
            assert_eq!(total, 235);
        }
        let (rows, total, _) = page(models(), "pi", Some("model-123".into()), 50, None).unwrap();
        assert_eq!(total, 1);
        assert_eq!(rows[0]["arg"], "vendor/model-123");
        let (_, _, cursor) = page(models(), "pi", None, 50, None).unwrap();
        assert!(page(models(), "pi", Some("123".into()), 50, cursor.clone()).is_err());
        assert!(page(models(), "fx", None, 50, cursor.clone()).is_err());
        let mut changed = models();
        changed.pop();
        assert!(page(changed, "pi", None, 50, cursor).is_err());
        assert!(page(models(), "pi", None, 50, Some("bogus".into())).is_err());
    }

    #[test]
    fn availability_does_not_repeat_an_unavailable_notice_for_an_installed_agent() {
        for available in [true, false] {
            let row = info(crate::AgentAvailability {
                harness: Harness::Pi,
                available,
                label: "pi".into(),
                reason: "pi is not installed".into(),
                install_command: None,
                docs_url: None,
                login_command: "pi".into(),
                login_hint: None,
            });
            assert_eq!(row.reason.is_none(), available);
        }
    }

    #[tokio::test]
    async fn a_creation_receipt_uses_recorded_settings_and_never_invents_a_default() {
        let mut item = SessionIndexItem::new(
            "fixture",
            Harness::ClaudeCode,
            "/fixture",
            "/fixture",
            None,
            None,
            "brief",
            ModelId::new("opus"),
            Some(Effort::High),
            ApprovalPolicy::Manual,
            true,
            None,
        );
        let effective = configuration(&item).await;
        assert_eq!(effective.model.as_deref(), Some("opus"));
        assert_eq!(effective.effort.as_deref(), Some("high"));
        assert_eq!(effective.mode.as_deref(), Some("manual"));
        assert!(effective.fast);
        item.harness = Harness::Pi;
        item.model = ModelId::default();
        item.effort = None;
        item.fast = false;
        let effective = configuration(&item).await;
        assert!(effective.model.is_none() && effective.effort.is_none() && !effective.fast);
        assert_eq!(effective.mode.as_deref(), Some("bypassPermissions"));
        item.harness = Harness::Fx;
        item.permission_mode = ApprovalPolicy::Plan;
        assert_eq!(configuration(&item).await.mode.as_deref(), Some("manual"));
        item.harness = Harness::Acp("fixture");
        item.agent_mode = Some("accept-edits".into());
        assert_eq!(
            configuration(&item).await.mode.as_deref(),
            Some("accept-edits")
        );
    }

    #[tokio::test]
    async fn receipt_models_are_reusable_aliases_and_legacy_modes_are_advertised() {
        let model = crate::models::codex_models()
            .into_iter()
            .find(|model| model.id.as_str() != model.arg)
            .unwrap();
        let mut item = SessionIndexItem::new(
            "alias",
            Harness::Codex,
            "/fixture",
            "/fixture",
            None,
            None,
            "brief",
            model.id.clone(),
            None,
            ApprovalPolicy::Plan,
            false,
            None,
        );
        let effective = configuration(&item).await;
        assert_eq!(effective.model.as_deref(), Some(model.arg.as_str()));
        assert_eq!(
            crate::models::id_for_arg(effective.model.as_deref().unwrap(), Harness::Codex),
            Some(model.id)
        );
        for (harness, inherited) in [
            (Harness::Codex, ApprovalPolicy::Plan),
            (Harness::Codex, ApprovalPolicy::DontAsk),
            (Harness::Pi, ApprovalPolicy::Plan),
        ] {
            item.harness = harness;
            item.model = ModelId::default();
            item.permission_mode = inherited;
            assert!(harness.controls().inherited_modes.contains(&inherited));
            assert_eq!(
                configuration(&item).await.mode.as_deref(),
                Some(inherited.as_arg())
            );
        }
    }

    #[test]
    fn typed_fallbacks_reject_misspelled_sources_and_targets() {
        let policy = serde_json::to_value(Harness::Fx.controls().live.clone()).unwrap();
        for fallbacks in [json!({"plan":"manul"}), json!({"plna":"manual"})] {
            let data = json!({"live":policy,"modes":[],"inheritedModes":[],"reasons":{},"fallbacks":fallbacks});
            assert!(serde_json::from_value::<crate::harness::HarnessControls>(data).is_err());
        }
    }

    #[test]
    fn each_mid_turn_change_is_checked_independently() {
        assert!(Harness::ClaudeCode
            .check_mid_turn_controls([true, false, false, false])
            .is_ok());
        assert!(Harness::ClaudeCode
            .check_mid_turn_controls([false, true, false, false])
            .is_err());
        assert!(Harness::Pi
            .check_mid_turn_controls([false, false, true, false])
            .is_err());
        assert!(Harness::Grok
            .check_mid_turn_controls([false, false, true, false])
            .is_err());
        assert!(Harness::Codex
            .check_mid_turn_controls([true, false, false, false])
            .is_err());
        assert!(Harness::Codex.check_mid_turn_controls([false; 4]).is_ok());
        assert!(Harness::Fx.check_mid_turn_controls([true; 4]).is_ok());
        let live = &Harness::ClaudeCode.controls().live;
        assert!(!live.effort.applies(true));
        assert!(live.effort.applies(false));
    }

    #[test]
    fn discovered_controls_match_the_running_turn_gate() {
        use carbon_proto::ControlTiming::*;
        let policies: serde_json::Map<String, Value> =
            serde_json::from_str(include_str!("../../../src/lib/harnessControls.json")).unwrap();
        for harness in Harness::ALL {
            assert!(policies.contains_key(&harness.wire_name()));
        }
        assert!(matches!(Harness::Fx.controls().live.model, NextTurn));
        assert!(!Harness::Fx.controls().live.model.applies(true));
        assert!(matches!(Harness::Codex.controls().live.model, Locked));
        assert!(!Harness::Codex.controls().live.model.applies(true));
        assert!(matches!(Harness::ClaudeCode.controls().live.effort, Locked));
        assert!(matches!(Harness::Pi.controls().live.stance, Locked));
        assert!(matches!(Harness::Grok.controls().live.model, InPlace));
        assert!(Harness::Grok.controls().live.model.applies(true));
        assert!(matches!(
            Harness::Acp("fixture").controls().live.model,
            Locked
        ));
    }
}
