use super::{model::*, storage::Store};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const RUNTIME: &str = include_str!("../../../src/lib/canvasRenderer.js");
const IMPORT: &str = include_str!("import.js");

fn runtime() -> String {
    RUNTIME.replace("export function", "function")
}

/// DOMParser reads HTML as data, with no source scripts, custom elements or network execution.
pub(super) async fn parse(html: &str, parent_tag: Option<&str>) -> Result<CanvasContent, String> {
    if html.len() > 512 * 1024 {
        return Err("HTML input exceeds 512 KiB. Write smaller groups.".into());
    }
    let script = format!(
        "(()=>{{{IMPORT};return parseCanvasHtml({},{});}})()",
        json!(html), json!(parent_tag)
    );
    let value = evaluate(script, 1440, 900, false).await?;
    let mut content: CanvasContent =
        serde_json::from_value(value).map_err(|e| format!("Invalid imported layers: {e}"))?;
    let mut ids = BTreeMap::new();
    for node in &mut content.nodes {
        super::nodes::reidentify(node, &mut ids);
    }
    Ok(content)
}

async fn assets(canvas: &Canvas, frame: &CanvasFrame) -> Result<BTreeMap<String, String>, String> {
    let store = Store::open().await?;
    let mut images = BTreeMap::new();
    let mut bytes = 0;
    for id in &frame.content.asset_ids {
        let image = store
            .read_asset(&canvas.id, id, Some(canvas.revision))
            .await?;
        bytes += image.data.len();
        if bytes > 16 * 1024 * 1024 {
            return Err("This frame's images exceed the 16 MiB preview limit.".into());
        }
        images.insert(
            id.clone(),
            format!("data:{};base64,{}", image.asset.mime_type, image.data),
        );
    }
    Ok(images)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CapturedStyle {
    pub styles: BTreeMap<String, String>,
    pub carbon_style_order: Vec<String>,
    pub retained: Vec<String>,
}

/// CSSOM applies shorthand replacement and removal without resolving variables prematurely.
pub(super) async fn styles(
    existing: &BTreeMap<String, String>,
    extra: &Extensions,
    patch: &BTreeMap<String, Option<String>>,
) -> Result<CapturedStyle, String> {
    let script = format!(
        r#"(()=>{{
        {IMPORT}
        return patchCanvasStyle({},{},{});
        }})()"#,
        json!(super::nodes::ordered_styles(existing, extra)),
        json!(extra.get("tokenReferences").and_then(Value::as_object).map(|refs| refs.keys().collect::<Vec<_>>()).unwrap_or_default()),
        json!(patch),
    );
    serde_json::from_value(evaluate(script, 1, 1, false).await?).map_err(|e| e.to_string())
}

/// The CLI and board share sanitization, viewport sizing and computed-style collection.
pub(super) async fn inspect(
    canvas: &Canvas,
    frame: &CanvasFrame,
    node: &str,
    screenshot: bool,
) -> Result<Value, String> {
    inspect_node(canvas, frame, node, screenshot, false).await
}

/// Hidden layers still have a stable identity. Use their frame for visual context.
pub(super) async fn reference_preview(
    canvas: &Canvas,
    frame: &CanvasFrame,
    node: &str,
) -> Result<(Value, bool), String> {
    let result = inspect_node(canvas, frame, node, true, true).await?;
    let frame_preview = result["framePreview"].as_bool().unwrap_or(false);
    Ok((result, frame_preview))
}

/// The handoff can fall back to the whole frame without changing CLI crop semantics.
async fn inspect_node(
    canvas: &Canvas,
    frame: &CanvasFrame,
    node: &str,
    screenshot: bool,
    frame_fallback: bool,
) -> Result<Value, String> {
    let width = frame.geometry.width.ceil() as u32;
    let height = frame.geometry.height.ceil() as u32;
    super::nodes::dimensions(width, height)?;
    let script = format!(
        r#"(async()=>{{
        {}
        const frame={}, assets={}, tokens={}, target={};
        const token={};
        document.body.style.cssText='margin:0;background:white';
        return await new Promise((resolve,reject)=>{{
            const timer=setTimeout(()=>reject(new Error('Canvas capture timed out')),15000);
            const iframe=document.createElement('iframe');
            iframe.sandbox='allow-scripts'; iframe.style.cssText='position:fixed;left:0;top:0;border:0;width:{}px;height:{}px';
            window.addEventListener('message',event=>{{
                if(event.source!==iframe.contentWindow||event.data?.canvasToken!==token)return;
                clearTimeout(timer);
                if(event.data.error){{reject(new Error(event.data.error));return;}}
                const boxes=event.data.boxes;
                const frameBox={{id:frame.id,x:0,y:0,width:frame.geometry.width,height:frame.geometry.height,styles:boxes.find(b=>b.id===frame.id)?.styles??{{}}}};
                const fallback={};
                const shot={};
                let box=target===frame.id?frameBox:boxes.find(b=>b.id===target);
                const crop=(b)=>{{const x=Math.max(0,b.x),y=Math.max(0,b.y);return {{x,y,width:Math.min(frame.geometry.width,b.x+b.width)-x,height:Math.min(frame.geometry.height,b.y+b.height)-y,scale:1}};}};
                let clip=box&&crop(box);
                let framePreview=false;
                if(fallback&&(!clip||clip.width<=0||clip.height<=0)){{box=frameBox;clip=crop(box);framePreview=true;}}
                if(!box){{reject(new Error('Layer is not rendered'));return;}}
                if(shot&&(clip.width<=0||clip.height<=0)){{reject(new Error('Layer has no visible area inside the frame'));return;}}
                if(fallback)clip.scale=Math.min(1,960/Math.max(clip.width,clip.height));
                resolve({{box,boxes,clip,framePreview}});
            }});
            iframe.onload=()=>{{iframe.getBoundingClientRect();iframe.contentWindow.postMessage({{canvasRender:token}},'*');}};
            iframe.srcdoc=frameDocument(frameMarkup(frame,tokens,assets),token,true,frame.geometry,null,target);
            document.body.append(iframe);
        }});
    }})()"#,
        runtime(),
        json!(frame),
        json!(assets(canvas, frame).await?),
        json!(canvas.tokens),
        json!(node),
        json!(uuid::Uuid::new_v4().simple().to_string()),
        width,
        height,
        frame_fallback,
        screenshot
    );
    evaluate(script, width, height, screenshot).await
}

/// Preview documents keep the same opaque CSP sandbox as the canvas's live iframe.
pub(super) async fn document(canvas: &Canvas, frame: &CanvasFrame) -> Result<String, String> {
    let script = format!(
        "(()=>{{{};return frameDocument(frameMarkup({},{},{}),{},false);}})()",
        runtime(),
        json!(frame),
        json!(canvas.tokens),
        json!(assets(canvas, frame).await?),
        json!(uuid::Uuid::new_v4().simple().to_string())
    );
    evaluate(script, 1, 1, false)
        .await?
        .as_str()
        .map(str::to_string)
        .ok_or("Invalid preview document.".into())
}

async fn evaluate(script: String, width: u32, height: u32, shot: bool) -> Result<Value, String> {
    #[cfg(any(feature = "serve", feature = "desktop"))]
    {
        crate::headless::canvas_eval(script, width, height, shot).await
    }
    #[cfg(not(any(feature = "serve", feature = "desktop")))]
    {
        let _ = (script, width, height, shot);
        Err("Canvas rendering needs the Carbon server.".into())
    }
}
