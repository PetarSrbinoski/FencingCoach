"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type AgentAction, type SavedFood, type VoiceDraft, type VoiceFood, type VoiceInterpretation } from "@/lib/api";
import { randomUUID } from "@/lib/uuid";
import { useEffect, useRef, useState } from "react";

const storageKey = "activeVoiceNutritionDraft";
const limitSeconds = 60;
const maxBytes = 10 * 1024 * 1024;
const formats = ["audio/webm", "audio/mp4", "audio/ogg"];
const macroFields = [
  ["kcal", "Calories (kcal)"], ["protein_g", "Protein (g)"],
  ["carbs_g", "Carbs (g)"], ["fat_g", "Fat (g)"], ["fiber_g", "Fiber (g)"],
] as const;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function decimal(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Use a nonnegative number.");
  return number;
}

export function VoiceLogging({ day, meal, onCommitted }: {
  day: string; meal: string; onCommitted: (day: string) => void;
}) {
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [transcript, setTranscript] = useState("");
  const [review, setReview] = useState<VoiceInterpretation | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [foods, setFoods] = useState<SavedFood[]>([]);
  const [logDay, setLogDay] = useState(day);
  const [logMeal, setLogMeal] = useState(meal || "");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<AgentAction | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setLogDay(day); }, [day]);
  useEffect(() => { api.foods.list().then(setFoods).catch(() => {}); }, []);
  useEffect(() => {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved || !/^\d+$/.test(saved)) return;
    api.voice.get(Number(saved)).then(setDraft).catch(() => sessionStorage.removeItem(storageKey));
    return () => stopRecording();
  }, []);
  useEffect(() => {
    if (!draft) return;
    setTranscript(draft.transcript || "");
    setReview(draft.interpretation);
    setReviewDirty(false);
    if (draft.accepted_action_id) {
      api.agentActions.get(draft.accepted_action_id).then(setReceipt).catch(() => {});
    }
  }, [draft?.id, draft?.revision, draft?.status]);
  useEffect(() => {
    if (!draft || draft.status !== "pending") return;
    const poll = setInterval(() => {
      api.voice.get(draft.id).then(setDraft).catch((reason) => setError(errorText(reason)));
    }, 1500);
    return () => clearInterval(poll);
  }, [draft?.id, draft?.status]);

  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setRecording(false);
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording is unavailable in this browser. Use manual entry or a supported browser.");
      return;
    }
    const mimeType = formats.find((format) => MediaRecorder.isTypeSupported(format));
    if (!mimeType) {
      setError("This browser cannot record a supported audio format. Use manual entry.");
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const chunks: Blob[] = [];
      const next = new MediaRecorder(media, { mimeType });
      recorder.current = next;
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => setError("Recording failed. Please try again.");
      next.onstop = async () => {
        media.getTracks().forEach((track) => track.stop());
        const audio = new Blob(chunks, { type: mimeType });
        if (!audio.size || audio.size > maxBytes) {
          setError(audio.size ? "Recording exceeds 10 MB. Try a shorter recording." : "No audio was captured.");
          return;
        }
        setBusy(true);
        try {
          const nextDraft = await api.voice.submit(audio);
          sessionStorage.setItem(storageKey, String(nextDraft.id));
          setDraft(nextDraft);
          setReceipt(null);
        } catch (reason) { setError(errorText(reason)); }
        finally { setBusy(false); }
      };
      next.start(250);
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => setSeconds((value) => {
        if (value + 1 >= limitSeconds) stopRecording();
        return value + 1;
      }), 1000);
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow access in your browser or use manual entry."
        : errorText(reason));
    }
  }

  async function correctTranscript() {
    if (!draft || !transcript.trim()) return;
    setBusy(true); setError(null);
    try { setDraft(await api.voice.correct(draft.id, transcript.trim(), draft.revision)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function saveReview() {
    if (!draft || !review) return;
    setBusy(true); setError(null);
    try { setDraft(await api.voice.review(draft.id, review, draft.revision)); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function cancel() {
    stopRecording();
    if (draft && !draft.accepted_action_id) {
      setBusy(true);
      try { await api.voice.cancel(draft.id); }
      catch (reason) { setError(errorText(reason)); setBusy(false); return; }
      setBusy(false);
    }
    sessionStorage.removeItem(storageKey);
    setDraft(null); setReceipt(null); setReview(null); setTranscript(""); setError(null);
  }

  async function accept(action: "save_food" | "log_consumption") {
    if (!draft || !review) return;
    if (transcript.trim() !== (draft.transcript || "").trim() || reviewDirty) {
      setError("Save your transcription and review changes before confirming.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const result = await api.voice.accept(draft.id, {
        expected_revision: draft.revision, action, request_id: randomUUID(),
        ...(action === "log_consumption" ? { day: logDay, meal: logMeal } : {}),
      });
      setReceipt(result);
      setDraft(await api.voice.get(draft.id));
      if (action === "log_consumption") onCommitted(logDay);
      else api.foods.list().then(setFoods).catch(() => {});
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function undo() {
    if (!receipt) return;
    setBusy(true); setError(null);
    try {
      setReceipt(await api.agentActions.undo(receipt.id, randomUUID()));
      onCommitted(logDay);
      api.foods.list().then(setFoods).catch(() => {});
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  function changeReview(change: Partial<VoiceInterpretation>) {
    if (!review) return;
    setReview({ ...review, ...change }); setReviewDirty(true);
  }
  function changeFood(change: Partial<VoiceFood>) {
    if (!review?.food) return;
    changeReview({ food: { ...review.food, ...change } });
  }

  return <div className="space-y-4 pt-4">
    <p className="text-sm text-muted-foreground">Record up to 60 seconds. Audio is used for transcription and discarded after processing. Supported: WebM, MP4, Ogg; 10 MB maximum.</p>
    <div className="flex flex-wrap gap-2">
      {!recording ? <Button type="button" onClick={startRecording} disabled={busy || (!!draft && !draft.accepted_action_id && draft.status !== "cancelled")}>Record voice</Button>
        : <Button type="button" variant="destructive" onClick={stopRecording}>Stop recording ({seconds}s)</Button>}
      {draft && <Button type="button" variant="outline" onClick={cancel} disabled={busy}>{draft.accepted_action_id ? "Start another" : "Cancel draft"}</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {draft?.status === "pending" && <p role="status">Processing speech and preparing your draft…</p>}
    {draft?.status === "error" && <p role="alert">{draft.error} You can correct the transcription or record again.</p>}
    {draft && draft.status !== "cancelled" && !draft.accepted_action_id && <div className="space-y-3 border border-border p-3">
      <label className="block text-sm font-medium">Transcription
        <Textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={3} aria-label="Correct transcription" />
      </label>
      <Button type="button" variant="outline" onClick={correctTranscript} disabled={busy || !transcript.trim() || transcript.trim() === (draft.transcript || "").trim()}>
        Reinterpret correction
      </Button>
    </div>}
    {review && draft?.status === "done" && !draft.accepted_action_id && <div className="space-y-4 border border-border p-3">
      <h3 className="font-semibold">Review interpretation</h3>
      {review.question && <p role="status" className="text-sm">Clarification needed: {review.question}</p>}
      <label className="block text-sm">Intended action
        <select className="mt-1 w-full rounded border border-border bg-background p-2" value={review.intent}
          onChange={(event) => changeReview({ intent: event.target.value as VoiceInterpretation["intent"] })}>
          <option value="clarify">Need clarification</option><option value="save_food">Save food</option><option value="log_consumption">Log consumption</option>
        </select>
      </label>
      {review.food && <div className="space-y-3">
        <h4 className="font-medium">Dictated food values</h4>
        <label className="block text-sm">Food name<Input value={review.food.name} onChange={(event) => changeFood({ name: event.target.value })} /></label>
        <label className="block text-sm">Values apply to
          <select className="mt-1 w-full rounded border border-border bg-background p-2" value={review.food.basis}
            onChange={(event) => changeFood({ basis: event.target.value as VoiceFood["basis"] })}>
            <option value="per_serving">Named serving</option><option value="per_100g">100 grams</option>
          </select>
        </label>
        {review.food.basis === "per_serving" && <label className="block text-sm">Value basis weight (g)
          <Input type="number" min="0" step="any" value={review.food.basis_grams ?? ""} onChange={(event) => changeFood({ basis_grams: decimal(event.target.value) })} />
        </label>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-sm">Serving name<Input value={review.food.serving_name ?? ""} onChange={(event) => changeFood({ serving_name: event.target.value || null })} /></label>
          <label className="text-sm">Serving weight (g)<Input type="number" min="0" step="any" value={review.food.serving_size_g ?? ""} onChange={(event) => changeFood({ serving_size_g: decimal(event.target.value) })} /></label>
          {review.intent === "log_consumption" && <label className="text-sm">Consumed amount (g)<Input type="number" min="0" step="any" value={review.food.consumed_grams ?? ""} onChange={(event) => changeFood({ consumed_grams: decimal(event.target.value) })} /></label>}
          {macroFields.map(([key, label]) => <label key={key} className="text-sm">{label}<Input type="number" min="0" step="any" placeholder="Unknown" value={review.food?.[key] ?? ""} onChange={(event) => changeFood({ [key]: decimal(event.target.value) })} /></label>)}
        </div>
        <p className="text-xs text-muted-foreground">Blank nutrients remain unknown. Zero is a known value.</p>
        {review.food.micros.map((micro, index) => <div key={index} className="grid grid-cols-3 gap-2 text-sm">
          <Input aria-label={`Nutrient ${index + 1} name`} value={micro.name} onChange={(event) => changeFood({ micros: review.food!.micros.map((value, i) => i === index ? { ...value, name: event.target.value } : value) })} />
          <Input aria-label={`Nutrient ${index + 1} amount`} type="number" min="0" step="any" value={micro.amount} onChange={(event) => changeFood({ micros: review.food!.micros.map((value, i) => i === index ? { ...value, amount: Number(event.target.value) } : value) })} />
          <select aria-label={`Nutrient ${index + 1} unit`} className="rounded border border-border bg-background p-2" value={micro.unit} onChange={(event) => changeFood({ micros: review.food!.micros.map((value, i) => i === index ? { ...value, unit: event.target.value as typeof value.unit } : value) })}>
            <option value="g">g</option><option value="mg">mg</option><option value="mcg">mcg</option><option value="IU">IU</option>
          </select>
        </div>)}
        <Button type="button" variant="outline" onClick={() => changeFood({ micros: [...review.food!.micros, { name: "", amount: 0, unit: "mg" }] })}>Add nutrient</Button>
      </div>}
      {review.portions.map((portion, index) => <div key={index} className="grid grid-cols-2 gap-2 text-sm">
        <p className="col-span-2">{foods.find((food) => food.id === portion.food_id)?.name || `Saved food #${portion.food_id}`}</p>
        <label>Amount<Input type="number" min="0" step="any" value={portion.grams ?? portion.servings ?? ""} onChange={(event) => {
          const amount = decimal(event.target.value);
          if (amount === null) return;
          changeReview({ portions: review.portions.map((value, i) => i === index ?
            (portion.grams !== undefined ? { food_id: portion.food_id, grams: amount } : { food_id: portion.food_id, servings: amount }) : value) });
        }} /></label>
        <label>Unit<select className="mt-1 w-full rounded border border-border bg-background p-2" value={portion.grams !== undefined ? "grams" : "servings"} onChange={(event) => changeReview({ portions: review.portions.map((value, i) => i === index ?
          (event.target.value === "grams" ? { food_id: portion.food_id, grams: portion.grams ?? 1 } : { food_id: portion.food_id, servings: portion.servings ?? 1 }) : value) })}>
          <option value="grams">grams</option><option value="servings">servings</option></select></label>
      </div>)}
      {review.other_foods && <label className="block text-sm">Other foods to estimate<Textarea value={review.other_foods} onChange={(event) => changeReview({ other_foods: event.target.value })} /></label>}
      {review.preview && <div className="text-sm" aria-label="Nutrition preview">
        <p>Preview: {review.preview.kcal} kcal · {review.preview.protein_g} g protein · {review.preview.carbs_g} g carbs · {review.preview.fat_g} g fat</p>
        <p>Fiber: {review.preview.fiber_g ?? "Unknown"} g</p>
      </div>}
      {review.intent === "log_consumption" && <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Day<Input type="date" value={logDay} onChange={(event) => setLogDay(event.target.value)} /></label>
        <label className="text-sm">Meal<select aria-label="Voice meal" className="mt-1 w-full rounded border border-border bg-background p-2" value={logMeal} onChange={(event) => setLogMeal(event.target.value)}>
          <option value="">Choose meal</option>{["breakfast", "lunch", "dinner", "snack", "pre", "post"].map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
      </div>}
      {reviewDirty && <Button type="button" variant="outline" onClick={saveReview} disabled={busy}>Update review</Button>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => accept("save_food")} disabled={busy || review.intent !== "save_food" || reviewDirty || transcript.trim() !== (draft.transcript || "").trim()}>Save food</Button>
        <Button type="button" onClick={() => accept("log_consumption")} disabled={busy || review.intent !== "log_consumption" || reviewDirty || !logDay || !logMeal || transcript.trim() !== (draft.transcript || "").trim()}>Log consumption</Button>
      </div>
    </div>}
    {receipt && <div role="status" className="space-y-2 rounded border border-border p-3 text-sm">
      <p>{receipt.status === "undone" ? "Change undone." : receipt.summary}</p>
      {receipt.status === "committed" && <Button type="button" variant="outline" onClick={undo} disabled={busy}>Undo in Agent logs</Button>}
    </div>}
  </div>;
}
