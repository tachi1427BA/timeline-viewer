"use strict";

const timelineStorageKey = "timelineViewer.lastJson.v1";

const elements = {
  inputPanel: document.getElementById("inputPanel"),
  inputBody: document.getElementById("inputBody"),
  input: document.getElementById("jsonInput"),
  loadButton: document.getElementById("loadButton"),
  toggleInputButton: document.getElementById("toggleInputButton"),
  message: document.getElementById("message"),
  emptyState: document.getElementById("emptyState"),
  viewer: document.getElementById("viewer"),
  timelineName: document.getElementById("timelineName"),
  battleTime: document.getElementById("battleTime"),
  eventCount: document.getElementById("eventCount"),
  bossId: document.getElementById("bossId"),
  exLabelMode: document.getElementById("exLabelMode"),
  chart: document.getElementById("timelineChart"),
  detailPopover: document.getElementById("detailPopover"),
  tableBody: document.getElementById("eventTableBody"),
};

const renderer = createTimelineRenderer(elements);

restoreLastTimeline();

elements.loadButton.addEventListener("click", () => {
  loadTimeline(elements.input.value);
});

elements.toggleInputButton.addEventListener("click", () => {
  setInputCollapsed(!elements.inputPanel.classList.contains("is-collapsed"));
});

elements.input.addEventListener("input", () => {
  writeLocalValue(timelineStorageKey, elements.input.value);
});

elements.input.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    loadTimeline(elements.input.value);
  }
});

function loadTimeline(rawText) {
  clearMessage();

  try {
    const timeline = TimelineData.parse(rawText);
    const normalized = TimelineData.normalize(timeline);
    renderer.render(normalized);
    writeLocalValue(timelineStorageKey, rawText);
    setInputCollapsed(true);
    setMessage(`${normalized.name} を読み込みました。`, "success");
  } catch (error) {
    renderer.showEmpty();
    setMessage(error.message, "error");
  }
}

function setMessage(text, type) {
  elements.message.textContent = text;
  elements.message.className = `message ${type || ""}`.trim();
}

function clearMessage() {
  setMessage("", "");
}

function setInputCollapsed(isCollapsed) {
  elements.inputPanel.classList.toggle("is-collapsed", isCollapsed);
  elements.toggleInputButton.textContent = isCollapsed ? "入力を編集" : "入力を隠す";
  elements.toggleInputButton.setAttribute("aria-expanded", String(!isCollapsed));
}

function restoreLastTimeline() {
  const savedJson = readLocalValue(timelineStorageKey);
  if (!savedJson) return;

  elements.input.value = savedJson;
  loadTimeline(savedJson);
}

function readLocalValue(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocalValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Restoring after reload is best-effort only.
  }
}
