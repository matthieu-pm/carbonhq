"use client";

import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Maximize, Minimize, Flag, Gamepad2, Heart, Play, RadioTower, RotateCcw, UsersRound, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClosingCards } from "@/components/home/ClosingCards";
import { Stripes } from "@/components/home/Stripes";
import { SITE } from "@/lib/links";
import { playCue, type Cue } from "./audio";
import { AGENT_NAMES, CREW_SIZE, STAGES, type AgentId } from "./engine";
import { drawPortrait } from "./render";
import { preloadVictoryScene, VictorySequence } from "./VictorySequence";
import { Playfield, type RunResult, formatTime } from "./Playfield";
import s from "./game.module.css";

const abilities: Record<AgentId, string> = {
  codex: "Repairs broken bridges.",
  claude: "Holds pressure plates.",
  pi: "Cuts power to fans.",
  fx: "Powers the shuttle.",
};

function Portrait({ id }: { id: AgentId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) return drawPortrait(ref.current, id); }, [id]);
  return <canvas ref={ref} width={128} height={128} className={s.portrait} aria-hidden="true" />;
}

function CrewRoster() {
  return <section className={s.roster} aria-labelledby="crew-heading">
    <div className={s.sectionHeading}><h2 id="crew-heading">Meet your crew</h2></div>
    <ol className={s.cards}>
      {STAGES.map((stage, index) => {
        if (!stage.rescue) return null;
        const recruit = stage.rescue.agent;
        return <li key={recruit} data-agent={recruit}>
          <div className={s.avatar}><Portrait id={recruit} /></div>
          <div><p className={s.floorNumber}>Floor 0{index + 1}</p><h3>{AGENT_NAMES[recruit]}</h3><p className={s.ability}>{abilities[recruit]}</p></div>
        </li>;
      })}
    </ol>
  </section>;
}

function Instructions({ back, start }: { back: () => void; start: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  return <div className={s.briefing}>
    <button type="button" className={s.textButton} onClick={back}><ArrowLeft size={15} /> Title screen</button>
    <h2 tabIndex={-1} ref={title}>How to play</h2>
    <p>Rescue four agents on the climb, then use their skills to restore the antenna on the fifth floor.</p>
    <dl className={s.ruleList}>
      <div><dt><Gamepad2 /> Move &amp; jump</dt><dd>Move with <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>. Press <kbd>Space</kbd> to jump. On touchscreens, use the on-screen buttons.</dd></div>
      <div><dt><UsersRound /> Rescue your crew</dt><dd>On the first four floors, follow the sign onto the exterior catwalk. Take the keycard at the far end and return to the cell. Press <kbd>E</kbd> or tap <strong>Free</strong> to rescue the agent and gain a life. Use the same control at crew machinery.</dd></div>
      <div><dt><Heart /> Hazards &amp; lives</dt><dd>Jump over spikes. Electric arcs flash amber before they fire. Cross when the posts go dark. You start with three lives. A fall or hit costs one and sends you to the floor checkpoint. At zero lives the run ends.</dd></div>
    </dl>
    <button type="button" className={s.primary} onClick={start}><Play fill="currentColor" size={16} /> Start shift</button>
  </div>;
}

function Results({ result, replay }: { result: RunResult; replay: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "select">("idle");
  const title = useRef<HTMLHeadingElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (copyStatus === "select") { fallback.current?.focus(); fallback.current?.select(); } }, [copyStatus]);
  const won = result.status === "won";
  const url = SITE + "/game";
  const time = formatTime(result.seconds);
  const share = won ? `I brought the tower back online in ${time} on Tower Shift! Can you beat it?` : `I reached floor ${result.stageIndex + 1} in Tower Shift. How high can you climb?`;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopyStatus("copied"); }
    catch { setCopyStatus("select"); }
  }
  return <div className={s.results}>
    <p className={s.signal}><RadioTower size={14} /> {won ? "Signal restored" : "Signal offline"}</p>
    <h2 tabIndex={-1} ref={title}>{won ? "Tower online." : "Shift over."}</h2>
    <p>{won ? "All four agents made it to the Signal Spire. The rooftop antenna is back online." : `Your last checkpoint was the ${STAGES[result.stageIndex].name}. The tower is ready for another run.`}</p>
    <div className={s.stats}><span><strong>{result.stageIndex + 1}/{STAGES.length}</strong> Floor reached</span><span><strong>{result.recruited}/{CREW_SIZE}</strong> Crew</span><span><strong>{time}</strong> Run time</span></div>
    <button type="button" className={s.primary} onClick={replay}><RotateCcw size={16} /> Play again</button>
    <div className={s.share}><span>Share your run</span>
      <a href={'https://twitter.com/intent/tweet?text=' + encodeURIComponent(share) + '&url=' + encodeURIComponent(url)} target="_blank" rel="noopener noreferrer">X <ArrowUpRight /></a>
      <a href={'https://bsky.app/intent/compose?text=' + encodeURIComponent(share + ' ' + url)} target="_blank" rel="noopener noreferrer">Bluesky <ArrowUpRight /></a>
      <button type="button" onClick={copy}>{copyStatus === "copied" ? <Check /> : <Copy />} {copyStatus === "copied" ? "Copied" : "Copy link"}</button>
    </div>
    {copyStatus === "select" && <input className={s.shareLink} ref={fallback} aria-label="Select and copy this game link" readOnly value={url} />}
  </div>;
}

export function TowerShift() {
  const [screen, setScreen] = useState<"title" | "rules" | "play" | "victory" | "end">("title");
  const [result, setResult] = useState<RunResult | null>(null);
  const [sound, setSound] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setCanExpand(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
    const sync = () => setExpanded(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setCanExpand(false); }
  }
  const audio = useRef<AudioContext | null>(null);
  const audible = useRef(false);
  const titleButton = useRef<HTMLButtonElement>(null);
  const cue = useCallback((kind: Cue) => {
    if (audible.current) return playCue(audio.current, kind);
  }, []);
  useEffect(() => () => { if (audio.current) void audio.current.close().catch(() => {}); }, []);
  async function toggleSound() {
    if (audible.current) { audible.current = false; setSound(false); return; }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      audible.current = true;
      setSound(true);
      cue("crew");
    } catch { setSound(false); }
  }
  const end = useCallback((run: RunResult) => {
    setResult(run);
    setScreen(run.status === "won" ? "victory" : "end");
  }, []);
  const finishCinematic = useCallback(() => setScreen("end"), []);
  function start() { preloadVictoryScene(); cue("floor"); setScreen("play"); }
  function backToTitle() {
    setScreen("title");
    requestAnimationFrame(() => titleButton.current?.focus({ preventScroll: true }));
  }
  const settings = <div className={s.settings}>
    <button type="button" className={s.sound} aria-pressed={sound} onClick={toggleSound}>{sound ? <Volume2 /> : <VolumeX />} Sound {sound ? "on" : "off"}</button>
    {canExpand && <button type="button" className={s.expand} aria-label={expanded ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>
      {expanded ? <Minimize size={17} /> : <Maximize size={17} />}
    </button>}
  </div>;
  return <main className={s.page}>
    {screen === "play" ? <Playfield onEnd={end} onTitle={backToTitle} cue={cue} settings={settings} /> :
      <div className={s.scene} data-view={screen}>
        {screen === "victory" || (screen === "end" && result?.status === "won") ?
          <VictorySequence playing={screen === "victory"} onFinish={finishCinematic} cue={cue} /> :
          <img className={s.keyArt} src="/game/tower-shift.webp" alt="" fetchPriority="high" width={1942} height={809} />}
        {screen !== "victory" && <header className={s.nav}>
          <div className={s.brand}><a href="/" aria-label="Carbon home"><img src="/icon-dark.svg" alt="" width="32" height="32" />Carbon</a><span className={s.slash}>/</span><span className={s.arcade}>Arcade</span></div>
          {settings}
        </header>}
        {screen === "title" ? <>
          <div className={s.titleCopy}>
            <p className={s.signal}><span className={s.signalLight} /> Tower offline</p>
            <h1 className={s.wordmark}><img src="/game/wordmark.png" alt="Tower Shift" width={128} height={57} /></h1>
            <p className={s.premise}>Climb the server tower. Rescue your crew.<br />Bring the signal back online.</p>
            <button type="button" className={s.primary} ref={titleButton} onClick={() => setScreen("rules")}><Play size={16} fill="currentColor" /> Play game <ArrowRight size={16} /></button>
          </div>
          <div className={s.rail}><div className={s.specs}><span><Flag />{STAGES.length} floors</span><span><Heart />3 starting lives</span><span><Gamepad2 />Keyboard + touch</span></div></div>
        </> : screen !== "victory" && <div className={s.sheetScroll} key={screen}>
          {screen === "rules" ? <div className={s.manual}>
            <Instructions back={backToTitle} start={start} /><CrewRoster />
          </div> : result && <div className={s.endSheet}>
            <Results result={result} replay={start} />
            <footer data-scheme="dark" className="relative min-w-0 bg-[#1612F8]">
              <Stripes />
              <ClosingCards />
            </footer>
          </div>}
        </div>}
      </div>}
  </main>;
}
