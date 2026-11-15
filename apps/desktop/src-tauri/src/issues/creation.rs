use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use super::{github, linear, linear_key, IssueRef, IssueTracker, IssueUnavailable};
use crate::store;

static WRITING: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub request_id: String,
    pub tracker: IssueTracker,
    pub destination: String,
    pub project_id: Option<String>,
    pub title: String,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
struct Receipt {
    input: CreateIssueInput,
    issue: Option<IssueRef>,
    #[serde(default)]
    started_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDestination {
    pub id: String,
    pub name: String,
    pub team_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct IssueCreationOptions {
    pub destinations: Vec<IssueDestination>,
    pub projects: Vec<IssueDestination>,
}

#[derive(Serialize)]
pub struct CreateIssueError {
    pub message: String,
    pub uncertain: bool,
}

fn tracker_error(error: IssueUnavailable) -> String {
    match error {
        IssueUnavailable::NotConnected => "Connect the tracker on the Issues page first.".into(),
        IssueUnavailable::Unauthorized => {
            "The tracker refused this connection. Reconnect it on the Issues page.".into()
        }
        IssueUnavailable::Offline(detail) | IssueUnavailable::Other(detail) => detail,
    }
}

const OPTIONS: &str = r#"query($after:String){
 teams(first:100,after:$after){nodes{id name} pageInfo{hasNextPage endCursor}}
}"#;
const PROJECTS: &str = r#"query($after:String){
 projects(first:100,after:$after){nodes{id name teams{nodes{id}}} pageInfo{hasNextPage endCursor}}
}"#;
const CREATE: &str = r#"mutation($input:IssueCreateInput!){
 issueCreate(input:$input){success issue{id identifier title url}}
}"#;
const FIND: &str = r#"query($id:String!){issue(id:$id){id identifier title url}}"#;

/// Reads destinations from the same connections as the Issues page.
pub async fn issue_creation_options(tracker: IssueTracker) -> Result<IssueCreationOptions, String> {
    if tracker == IssueTracker::Github {
        return Ok(IssueCreationOptions {
            destinations: github::repos_of_projects()
                .await
                .into_iter()
                .map(|repo| IssueDestination {
                    id: repo.clone(),
                    name: repo,
                    team_ids: vec![],
                })
                .collect(),
            projects: vec![],
        });
    }
    let key = linear_key().await.map_err(tracker_error)?;
    let (destinations, projects) = tokio::try_join!(
        read_options(&key, OPTIONS, "teams"),
        read_options(&key, PROJECTS, "projects")
    )?;
    Ok(IssueCreationOptions {
        destinations,
        projects,
    })
}

async fn read_options(
    key: &str,
    document: &str,
    field: &str,
) -> Result<Vec<IssueDestination>, String> {
    let mut after: Option<String> = None;
    let mut rows = vec![];
    loop {
        let data = linear::query(key, document, json!({"after": after}))
            .await
            .map_err(tracker_error)?;
        let page = &data[field];
        let nodes = page["nodes"]
            .as_array()
            .ok_or("Could not read issue destinations.")?;
        for node in nodes {
            let id = node["id"].as_str().ok_or("A destination has no id.")?;
            let name = node["name"].as_str().ok_or("A destination has no name.")?;
            rows.push(IssueDestination {
                id: id.into(),
                name: name.into(),
                team_ids: node["teams"]["nodes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t["id"].as_str().map(String::from))
                    .collect(),
            });
        }
        if page["pageInfo"]["hasNextPage"] != true {
            break;
        }
        let next = page["pageInfo"]["endCursor"]
            .as_str()
            .ok_or("Missing destination cursor.")?
            .to_string();
        if after.as_ref() == Some(&next) {
            return Err("Issue destinations repeated a page.".into());
        }
        after = Some(next);
    }
    Ok(rows)
}

fn validate(input: &CreateIssueInput) -> Result<(), String> {
    uuid::Uuid::parse_str(&input.request_id).map_err(|_| "Invalid creation id.")?;
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 256 {
        return Err("Give the issue a title of at most 256 characters.".into());
    }
    if input.description.len() > 60_000 {
        return Err("The description is too long (60,000 bytes maximum).".into());
    }
    if input.destination.is_empty() {
        return Err("Choose a team or repository.".into());
    }
    if input.tracker == IssueTracker::Github {
        let parts: Vec<_> = input.destination.split('/').collect();
        if parts.len() != 2
            || parts.iter().any(|p| {
                p.is_empty()
                    || *p == "."
                    || *p == ".."
                    || !p
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            })
        {
            return Err("Choose a repository in owner/repository form.".into());
        }
        if input.project_id.is_some() {
            return Err("GitHub issues do not take a Linear project.".into());
        }
    } else {
        uuid::Uuid::parse_str(&input.destination).map_err(|_| "Choose a Linear team.")?;
        if let Some(project) = &input.project_id {
            uuid::Uuid::parse_str(project).map_err(|_| "Choose a Linear project.")?;
        }
    }
    Ok(())
}

fn linear_ref(value: &Value) -> Result<IssueRef, String> {
    let get = |field| {
        value[field]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(String::from)
            .ok_or_else(|| format!("The created issue has no {field}."))
    };
    Ok(IssueRef {
        tracker: IssueTracker::Linear,
        id: get("id")?,
        identifier: get("identifier")?,
        title: get("title")?,
        url: get("url")?,
    })
}

fn github_ref(value: &Value, repo: &str) -> Result<IssueRef, String> {
    let number = value["number"]
        .as_u64()
        .ok_or("The created issue has no number.")?;
    Ok(IssueRef {
        tracker: IssueTracker::Github,
        id: value["node_id"]
            .as_str()
            .ok_or("The created issue has no id.")?
            .into(),
        identifier: format!("{repo}#{number}"),
        title: value["title"]
            .as_str()
            .ok_or("The created issue has no title.")?
            .into(),
        url: value["html_url"]
            .as_str()
            .ok_or("The created issue has no URL.")?
            .into(),
    })
}

/// Records the attempt before sending, so a lost response cannot create a second issue on retry.
pub async fn create_issue(input: CreateIssueInput) -> Result<IssueRef, CreateIssueError> {
    let result = create(input.clone()).await;
    match result {
        Ok(issue) => Ok(issue),
        Err(message) => {
            let uncertain = if uuid::Uuid::parse_str(&input.request_id).is_ok() {
                match store::get_home_app_dir().await {
                    Ok(home) => tokio::fs::try_exists(
                        home.join("issue-creations")
                            .join(format!("{}.json", input.request_id)),
                    )
                    .await
                    .unwrap_or(true),
                    Err(_) => true,
                }
            } else {
                false
            };
            Err(CreateIssueError { message, uncertain })
        }
    }
}

async fn create(input: CreateIssueInput) -> Result<IssueRef, String> {
    validate(&input)?;
    let _guard = WRITING.lock().await;
    let dir = store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("issue-creations");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", input.request_id));
    let previous = match tokio::fs::read(&path).await {
        Ok(bytes) => Some(serde_json::from_slice::<Receipt>(&bytes).map_err(|e| e.to_string())?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if let Some(receipt) = &previous {
        if receipt.input != input {
            return Err("This creation was already sent with different content. Check the tracker before starting another issue.".into());
        }
        if let Some(issue) = &receipt.issue {
            return Ok(issue.clone());
        }
    }
    let receipt = Receipt {
        input: input.clone(),
        issue: None,
        started_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };
    let save = |receipt: &Receipt| -> Result<(), String> {
        let bytes = serde_json::to_vec(receipt).map_err(|e| e.to_string())?;
        store::write_private_atomic(&path, &bytes).map_err(|e| e.to_string())
    };
    let issue = if input.tracker == IssueTracker::Linear {
        let key = linear_key().await.map_err(tracker_error)?;
        if previous.is_some() {
            let data = linear::query(&key, FIND, json!({"id": input.request_id}))
                .await
                .map_err(|_| {
                    "Creation is unconfirmed. Check Linear before starting another issue."
                        .to_string()
                })?;
            linear_ref(&data["issue"])?
        } else {
            save(&receipt)?;
            let data = linear::query(&key, CREATE, json!({"input": {
                "id": input.request_id, "teamId": input.destination, "projectId": input.project_id,
                "title": input.title.trim(), "description": input.description,
            }})).await.map_err(|e| format!("Creation is unconfirmed. Check Linear, then use Check creation. {}", tracker_error(e)))?;
            if data["issueCreate"]["success"] != true {
                let _ = tokio::fs::remove_file(&path).await;
                return Err(
                    "Linear refused to create the issue. Check your write access and destination."
                        .into(),
                );
            }
            linear_ref(&data["issueCreate"]["issue"])?
        }
    } else {
        let dir = github::neutral_dir().await.map_err(tracker_error)?;
        let marker = format!("<!-- carbon-issue:{} -->", input.request_id);
        let endpoint = format!("repos/{}/issues", input.destination);
        if previous.is_some() {
            let since = previous
                .as_ref()
                .map(|r| r.started_at.as_str())
                .filter(|s| !s.is_empty());
            let endpoint = format!(
                "{endpoint}?state=all&sort=created&direction=desc&per_page=100{}",
                since.map(|s| format!("&since={s}")).unwrap_or_default()
            );
            let out = github::run(&dir, &["api", &endpoint, "--paginate", "--slurp"])
                .await
                .map_err(tracker_error)?;
            let pages: Vec<Vec<Value>> = serde_json::from_str(&out).map_err(|e| e.to_string())?;
            let found = pages
                .iter()
                .flatten()
                .find(|i| {
                    i["body"]
                        .as_str()
                        .is_some_and(|body| body.ends_with(&marker))
                })
                .ok_or("Creation is unconfirmed. Check GitHub before starting another issue.")?;
            github_ref(found, &input.destination)?
        } else {
            let body = format!("{}\n\n{marker}", input.description);
            save(&receipt)?;
            let out = github::run(
                &dir,
                &[
                    "api",
                    "--method",
                    "POST",
                    &endpoint,
                    "-f",
                    &format!("title={}", input.title.trim()),
                    "-f",
                    &format!("body={body}"),
                ],
            )
            .await
            .map_err(|e| {
                format!(
                    "Creation is unconfirmed. Check GitHub, then use Check creation. {}",
                    tracker_error(e)
                )
            })?;
            github_ref(
                &serde_json::from_str::<Value>(&out).map_err(|e| e.to_string())?,
                &input.destination,
            )?
        }
    };
    save(&Receipt {
        input,
        issue: Some(issue.clone()),
        started_at: receipt.started_at,
    })?;
    Ok(issue)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> CreateIssueInput {
        CreateIssueInput {
            request_id: uuid::Uuid::new_v4().to_string(),
            tracker: IssueTracker::Github,
            destination: "acme/web".into(),
            project_id: None,
            title: "Fix login".into(),
            description: "Steps".into(),
        }
    }

    #[test]
    fn refuses_invalid_destinations_before_a_write() {
        for destination in [
            "",
            "acme",
            "acme/../issues",
            "acme/..",
            "-R acme/web",
            "acme/web?x=1",
        ] {
            assert!(validate(&CreateIssueInput {
                destination: destination.into(),
                ..input()
            })
            .is_err());
        }
        assert!(validate(&input()).is_ok());
        assert!(validate(&CreateIssueInput {
            title: " \n".into(),
            ..input()
        })
        .is_err());
    }

    #[test]
    fn a_receipt_keeps_the_exact_reviewed_payload_and_result() {
        let receipt = Receipt {
            input: input(),
            started_at: "2026-11-15T17:00:00Z".into(),
            issue: Some(IssueRef {
                tracker: IssueTracker::Github,
                id: "I_1".into(),
                identifier: "acme/web#1".into(),
                title: "Fix login".into(),
                url: "https://github.com/acme/web/issues/1".into(),
            }),
        };
        let restored: Receipt =
            serde_json::from_slice(&serde_json::to_vec(&receipt).unwrap()).unwrap();
        assert_eq!(restored.input, receipt.input);
        assert_eq!(restored.issue, receipt.issue);
    }
}
