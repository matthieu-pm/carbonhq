use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DiscoveryRequest {
    Harnesses,
    Harness {
        harness: String,
    },
    Models {
        harness: String,
        query: Option<String>,
        limit: u32,
        cursor: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    pub harness: String,
    pub label: String,
    pub available: bool,
    pub reason: Option<String>,
    pub install_command: Option<String>,
    pub docs_url: Option<String>,
    pub login_command: String,
    pub login_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlTiming {
    InPlace,
    NextTurn,
    Locked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveControls {
    pub model: ControlTiming,
    pub effort: ControlTiming,
    pub stance: ControlTiming,
    pub fast: ControlTiming,
}

impl LiveControls {
    /// Preserve the same control order for validation and application.
    pub fn entries(&self) -> [(&'static str, &ControlTiming); 4] {
        [
            ("model", &self.model),
            ("effort", &self.effort),
            ("stance", &self.stance),
            ("fast", &self.fast),
        ]
    }

    /// Only deferred picks need to wait for the queued turn's flush.
    pub fn deferred(&self) -> bool {
        self.entries()
            .iter()
            .any(|(_, timing)| matches!(timing, ControlTiming::NextTurn))
    }
}

impl ControlTiming {
    /// Idle children take ordinary setters; running children take only verified live setters.
    pub fn applies(&self, during_turn: bool) -> bool {
        !during_turn || matches!(self, Self::InPlace)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveConfiguration {
    pub harness: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: Option<String>,
    pub fast: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum DiscoveryData {
    Harnesses {
        harnesses: Vec<HarnessInfo>,
    },
    Harness {
        harness: HarnessInfo,
        // These payloads retain the app's model and ACP schemas without a second projection.
        capabilities: serde_json::Value,
        live_controls: LiveControls,
        modes: serde_json::Value,
        options: Vec<serde_json::Value>,
        options_source: String,
        default_model: Option<String>,
    },
    Models {
        harness: HarnessInfo,
        models: Vec<serde_json::Value>,
        total: usize,
        next_cursor: Option<String>,
        catalog_reason: Option<String>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CreateSession, Envelope, OnMachine, Request, Response};

    #[test]
    fn discovery_and_configuration_receipts_require_v20_on_both_machines() {
        for request in [
            Request::Discover(DiscoveryRequest::Harnesses),
            Request::Discover(DiscoveryRequest::Harness {
                harness: "acp:agent".into(),
            }),
            Request::Discover(DiscoveryRequest::Models {
                harness: "pi".into(),
                query: Some("vendor".into()),
                limit: 50,
                cursor: None,
            }),
            Request::CreateSession(CreateSession {
                configuration: true,
                ..Default::default()
            }),
        ] {
            assert_eq!(request.version(), 20);
            let request = Request::OnMachine(OnMachine {
                machine: "vps".into(),
                request: Box::new(request),
            });
            let encoded = serde_json::to_string(&Envelope::new(request)).unwrap();
            let decoded: Envelope = serde_json::from_str(&encoded).unwrap();
            assert_eq!(decoded.v, 20);
            assert_eq!(decoded.request.version(), 20);
        }
        let old = serde_json::to_value(CreateSession::default()).unwrap();
        assert!(
            old.get("configuration").is_none(),
            "legacy retry fingerprints stay unchanged"
        );
    }

    #[test]
    fn an_older_creation_response_remains_readable() {
        let response: Response = serde_json::from_value(serde_json::json!({
            "status":"created", "session": {"sessionId":"s", "title":"t", "cwd":"/tmp", "projectPath":"/tmp", "branch":null, "worktreeName":null, "status":"idle", "modified":""}
        })).unwrap();
        assert!(matches!(
            response,
            Response::Created {
                configuration: None,
                ..
            }
        ));
    }
}
