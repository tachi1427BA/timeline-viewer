"use strict";

function createTimelineRenderer(elements) {
  const nsStorageKey = "timelineViewer.nsSettings.v1";
  const exLabelModeStorageKey = "timelineViewer.exLabelMode.v1";
  let currentEvents = [];
  let selectedEventId = null;
  let hoverCloseTimer = 0;
  let currentTimeline = null;
  let nsSettings = readNsSettings();
  let exLabelMode = readExLabelMode();
  let isNsInputBound = false;
  let nsRenderTimer = 0;

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideDetails();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!elements.detailPopover || elements.detailPopover.classList.contains("is-hidden")) return;
    if (event.target.closest("[data-event-id]") || elements.detailPopover.contains(event.target)) return;
    hideDetails();
  });

  elements.detailPopover?.addEventListener("input", handleNsDelayInput);
  elements.detailPopover?.addEventListener("change", handleNsDelayInput);
  elements.detailPopover?.addEventListener("mouseenter", () => window.clearTimeout(hoverCloseTimer));
  elements.detailPopover?.addEventListener("mouseleave", scheduleHideDetails);
  if (elements.exLabelMode) {
    elements.exLabelMode.value = exLabelMode;
    elements.exLabelMode.addEventListener("change", handleExLabelModeChange);
  }

  function render(timeline) {
    currentTimeline = timeline;
    currentEvents = timeline.events;
    selectedEventId = timeline.events[0]?.id || null;

    elements.emptyState.classList.add("is-hidden");
    elements.viewer.classList.remove("is-hidden");
    elements.timelineName.textContent = timeline.name;
    elements.battleTime.textContent = `${formatSeconds(timeline.battleTime)} (${timeline.battleTime}s)`;
    elements.eventCount.textContent = String(timeline.events.length);
    elements.bossId.textContent = String(timeline.bossId);

    renderChart(timeline);
    bindNsInputs();
    renderEventTable(timeline.events);
    hideDetails();
    syncSelection();
  }

  function renderChart(timeline) {
    elements.chart.innerHTML = "";

    const axis = document.createElement("div");
    axis.className = "time-axis";
    axis.appendChild(createElement("div", "axis-spacer", ""));

    const axisTrack = createElement("div", "axis-track", "");
    createAxisMarks(axisTrack, timeline.battleTime);
    axis.appendChild(axisTrack);
    elements.chart.appendChild(axis);

    const gridStep = `${100 / getAxisIntervalCount(timeline.battleTime)}%`;

    timeline.lanes.forEach((lane) => {
      const laneRow = document.createElement("div");
      laneRow.className = "lane";
      laneRow.style.setProperty("--grid-step", gridStep);

      const label = document.createElement("div");
      label.className = "lane-label";
      label.innerHTML = `
        <span class="lane-icon-wrap">${renderLaneIcon(lane)}</span>
        <span class="lane-text">
          <span class="lane-name" title="${escapeHtml(lane.name)}">${escapeHtml(lane.name)}</span>
        </span>
        ${renderNsControls(lane)}
      `;
      laneRow.appendChild(label);

      const track = document.createElement("div");
      track.className = "lane-track";
      track.dataset.laneKey = lane.key;

      timeline.events
        .filter((event) => event.laneKey === lane.key)
        .forEach((event) => {
          track.appendChild(createEventChip(event, timeline.battleTime));
        });

      createNsEvents(lane, timeline.battleTime).forEach((event) => {
        track.appendChild(createNsEventBar(event, timeline.battleTime));
      });

      laneRow.appendChild(track);
      elements.chart.appendChild(laneRow);
    });
  }

  function renderNsControls(lane) {
    const setting = getNsSetting(lane.key);
    return `
      <span class="lane-ns-controls" aria-label="${escapeHtml(lane.name)} NS設定">
        <span class="lane-ns-title">NS</span>
        <label><input type="text" inputmode="decimal" data-ns-field="interval" data-lane-key="${escapeHtml(lane.key)}" value="${escapeHtml(formatInputNumber(setting.interval))}"><span>秒ごと</span></label>
        <label><input type="text" inputmode="decimal" data-ns-field="duration" data-lane-key="${escapeHtml(lane.key)}" value="${escapeHtml(formatInputNumber(setting.duration))}"><span>秒間</span></label>
      </span>
    `;
  }

  function handleNsInput(event) {
    const input = event.target.closest?.("input[data-ns-field]");
    if (!input) return;

    const laneKey = input.dataset.laneKey;
    const field = input.dataset.nsField;
    const setting = getNsSetting(laneKey);
    setting[field] = parseSecondsInput(input.value);
    nsSettings[laneKey] = setting;

    if (currentTimeline) {
      scheduleNsLayerRender(laneKey);
      hideDetails();
      syncSelection();
    }

    writeNsSettings(nsSettings);
  }

  function scheduleNsLayerRender(laneKey) {
    window.clearTimeout(nsRenderTimer);
    nsRenderTimer = window.setTimeout(() => renderNsLayer(laneKey), 120);
  }

  function bindNsInputs() {
    if (isNsInputBound) return;

    elements.chart.addEventListener("input", handleNsInput);
    elements.chart.addEventListener("change", handleNsInput);
    isNsInputBound = true;
  }

  function renderNsLayer(laneKey) {
    const lane = currentTimeline?.lanes.find((item) => item.key === laneKey);
    if (!lane) return;

    const track = Array.from(elements.chart.querySelectorAll(".lane-track"))
      .find((item) => item.dataset.laneKey === laneKey);
    if (!track) return;

    track.querySelectorAll(".ns-event").forEach((item) => item.remove());
    createNsEvents(lane, currentTimeline.battleTime).forEach((event) => {
      track.appendChild(createNsEventBar(event, currentTimeline.battleTime));
    });
  }

  function createAxisMarks(axisTrack, battleTime) {
    const step = chooseAxisStep(battleTime);
    const marks = [];
    for (let second = 0; second <= battleTime; second += step) {
      marks.push(second);
    }
    if (marks[marks.length - 1] !== battleTime) {
      marks.push(battleTime);
    }

    marks.forEach((second) => {
      const mark = createElement("span", "axis-mark", `${second}s`);
      mark.style.left = `${(second / battleTime) * 100}%`;
      axisTrack.appendChild(mark);
    });
  }

  function createEventChip(event, battleTime) {
    if (event.typeIndex === 0) {
      return createExEventChip(event, battleTime);
    }

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `event-chip ${event.typeIndex === 1 ? "event-type-event" : ""} ${event.canUsable ? "" : "is-disabled"}`;
    chip.dataset.eventId = event.id;
    chip.style.left = `calc(${(event.elapsedTime / battleTime) * 100}% - 12px)`;
    chip.style.setProperty("--chip-color", event.typeIndex === 0 ? event.color : "var(--event)");
    chip.title = `${formatSeconds(event.elapsedTime)} / ${event.title}`;
    chip.innerHTML = `
      <span class="chip-time">${escapeHtml(formatSeconds(event.elapsedTime))}</span>
      <span class="chip-title">${escapeHtml(formatChipTitle(event))}</span>
    `;

    attachDetailTriggers(chip, event);
    return chip;
  }

  function createNsEventBar(event, battleTime) {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "ns-event";
    bar.dataset.eventId = event.id;
    bar.dataset.laneKey = event.laneKey;
    bar.dataset.nsIndex = String(event.nsIndex);
    bar.style.left = `${(event.elapsedTime / battleTime) * 100}%`;
    bar.style.width = `${(event.duration / battleTime) * 100}%`;
    bar.title = `${formatSeconds(event.elapsedTime)} / ${event.title} / ${formatNumber(event.duration, "0")}s`;
    bar.innerHTML = `<span>${escapeHtml(formatNsLabel(event))}</span>`;
    attachDetailTriggers(bar, event);
    return bar;
  }

  function createExEventChip(event, battleTime) {
    const chip = document.createElement("button");
    const duration = Math.min(event.exEffectTime, Math.max(0, battleTime - event.elapsedTime));
    const hasDuration = duration > 0;

    chip.type = "button";
    chip.className = `ex-event ${event.canUsable ? "" : "is-disabled"}`;
    chip.dataset.eventId = event.id;
    if (hasDuration) {
      chip.classList.add("has-duration");
      chip.style.left = `${(event.elapsedTime / battleTime) * 100}%`;
      chip.style.width = `${(duration / battleTime) * 100}%`;
    } else {
      chip.style.left = `calc(${(event.elapsedTime / battleTime) * 100}% - 21px)`;
      chip.style.width = "42px";
    }
    chip.style.setProperty("--chip-color", event.color);
    chip.title = `${formatSeconds(event.elapsedTime)} / ${event.title}${hasDuration ? ` / 効果 ${formatNumber(duration, "0")}s` : ""}`;

    if (hasDuration) {
      const effectBar = document.createElement("span");
      effectBar.className = "ex-effect-bar";
      chip.appendChild(effectBar);
    }

    const marker = document.createElement("span");
    marker.className = "ex-icon-marker";
    marker.innerHTML = renderIconImage(event, "event-icon");
    chip.appendChild(marker);

    const costLabel = document.createElement("span");
    costLabel.className = "ex-cost-label";
    costLabel.textContent = formatExIconLabel(event);
    chip.appendChild(costLabel);

    attachDetailTriggers(chip, event);
    return chip;
  }

  function renderEventTable(events) {
    elements.tableBody.innerHTML = "";
    events.forEach((event) => {
      const row = document.createElement("tr");
      row.dataset.eventId = event.id;
      row.innerHTML = `
        <td>${escapeHtml(formatSeconds(event.elapsedTime))}</td>
        <td>${escapeHtml(formatSeconds(event.remainTime))}</td>
        <td>${escapeHtml(event.title)}<br><span class="lane-meta">${escapeHtml(event.characterName)}</span></td>
        <td><span class="badge ${event.typeIndex === 1 ? "event" : ""}">${escapeHtml(formatType(event))}</span></td>
        <td>${escapeHtml(formatCost(event))}</td>
        <td>${escapeHtml(formatNumber(event.waitTime, "-"))}</td>
      `;
      row.tabIndex = 0;
      attachDetailTriggers(row, event);
      elements.tableBody.appendChild(row);
    });
  }

  function attachDetailTriggers(target, event) {
    target.addEventListener("click", () => {
      selectEvent(event.id);
      showDetails(event, target);
    });
    target.addEventListener("mouseenter", () => showDetails(event, target));
    target.addEventListener("focus", () => showDetails(event, target));
    target.addEventListener("mouseleave", scheduleHideDetails);
    target.addEventListener("blur", (blurEvent) => {
      if (event.kind === "NS" && elements.detailPopover?.contains(blurEvent.relatedTarget)) return;
      scheduleHideDetails();
    });
  }

  function showDetails(event, anchor) {
    if (!event || !elements.detailPopover) return;
    window.clearTimeout(hoverCloseTimer);
    elements.detailPopover.innerHTML = renderDetailHtml(event);
    elements.detailPopover.classList.remove("is-hidden");
    elements.detailPopover.dataset.eventId = event.id || "";
    elements.detailPopover.dataset.laneKey = event.laneKey || "";
    elements.detailPopover.dataset.nsIndex = event.kind === "NS" ? String(event.nsIndex) : "";
    positionPopover(anchor);
  }

  function scheduleHideDetails() {
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = window.setTimeout(hideDetails, 80);
  }

  function hideDetails() {
    window.clearTimeout(hoverCloseTimer);
    elements.detailPopover?.classList.add("is-hidden");
    if (elements.detailPopover) {
      elements.detailPopover.dataset.eventId = "";
      elements.detailPopover.dataset.laneKey = "";
      elements.detailPopover.dataset.nsIndex = "";
    }
  }

  function positionPopover(anchor) {
    const popover = elements.detailPopover;
    const anchorRect = anchor.getBoundingClientRect();
    const margin = 12;
    const preferredLeft = anchorRect.right + margin;
    const preferredTop = anchorRect.top - 8;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const maxLeft = window.innerWidth - width - margin;
    const maxTop = window.innerHeight - height - margin;

    let left = preferredLeft;
    if (left > maxLeft) {
      left = anchorRect.left - width - margin;
    }
    left = Math.max(margin, Math.min(left, maxLeft));

    let top = preferredTop;
    if (top > maxTop) {
      top = anchorRect.bottom - height + 8;
    }
    top = Math.max(margin, Math.min(top, maxTop));

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function renderDetailHtml(event) {
    if (event.kind === "NS") {
      return `
        <dl class="detail-grid">
          <dt>種別</dt><dd>NS</dd>
          <dt>キャラ</dt><dd>${escapeHtml(event.characterName)}${event.characterId === null ? "" : ` (ID: ${event.characterId})`}</dd>
          <dt>基準発動</dt><dd>${escapeHtml(formatSeconds(event.baseStart))}</dd>
          <dt>この回の遅延</dt><dd><label class="ns-delay-control"><input type="text" inputmode="decimal" data-ns-delay-input="true" data-lane-key="${escapeHtml(event.laneKey)}" data-ns-index="${event.nsIndex}" value="${escapeHtml(formatInputNumber(event.delay))}"><span>秒</span></label></dd>
          <dt>累積遅延</dt><dd>${escapeHtml(formatNumber(event.totalDelay, "-"))}s</dd>
          <dt>実発動</dt><dd>${escapeHtml(formatSeconds(event.elapsedTime))}</dd>
          <dt>残り時間</dt><dd>${escapeHtml(formatSeconds(event.remainTime))}</dd>
          <dt>発動間隔</dt><dd>${escapeHtml(formatNumber(event.interval, "-"))}s</dd>
          <dt>効果時間</dt><dd>${escapeHtml(formatNumber(event.duration, "-"))}s</dd>
        </dl>
      `;
    }

    return `
      <dl class="detail-grid">
        <dt>経過時間</dt><dd>${escapeHtml(formatSeconds(event.elapsedTime))}</dd>
        <dt>残り時間</dt><dd>${escapeHtml(formatSeconds(event.remainTime))}</dd>
        <dt>キャラ</dt><dd>${escapeHtml(event.characterName)}${event.characterId === null ? "" : ` (ID: ${event.characterId})`}</dd>
        <dt>IconName</dt><dd>${escapeHtml(event.iconName || "-")}</dd>
        <dt>種別</dt><dd>${escapeHtml(formatType(event))}</dd>
        <dt>EX効果時間</dt><dd>${escapeHtml(event.typeIndex === 0 && event.exEffectTime > 0 ? `${formatNumber(event.exEffectTime, "-")}s` : "-")}</dd>
        <dt>説明</dt><dd>${escapeHtml(event.description || "-")}</dd>
        <dt>発動時コスト</dt><dd>${escapeHtml(formatNumber(event.remainCost, "-"))}</dd>
        <dt>OverrideCost</dt><dd>${escapeHtml(formatNumber(event.overrideCost, "-"))}</dd>
        <dt>WaitTime</dt><dd>${escapeHtml(formatNumber(event.waitTime, "-"))}</dd>
        <dt>TargetId</dt><dd>${escapeHtml(event.targetId === null ? "-" : String(event.targetId))}</dd>
        <dt>使用可否</dt><dd>${event.canUsable ? "使用可" : "使用不可"}</dd>
        <dt>Cost設定</dt><dd>${event.isOverrideCostSet ? "明示" : "未設定"}</dd>
        <dt>Self</dt><dd>${event.isSelf ? "true" : "false"}</dd>
      </dl>
    `;
  }

  function selectEvent(eventId) {
    selectedEventId = eventId;
    syncSelection();
  }

  function syncSelection() {
    document.querySelectorAll("[data-event-id]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.eventId === selectedEventId);
    });
  }

  function showEmpty() {
    currentEvents = [];
    selectedEventId = null;
    elements.viewer.classList.add("is-hidden");
    elements.emptyState.classList.remove("is-hidden");
    elements.chart.innerHTML = "";
    elements.tableBody.innerHTML = "";
    hideDetails();
  }

  function createNsEvents(lane, battleTime) {
    const setting = getNsSetting(lane.key);
    const interval = Number(setting.interval) || 0;
    const duration = Number(setting.duration) || 0;
    if (interval <= 0 || duration <= 0) return [];

    const events = [];
    let totalDelay = 0;
    for (let baseStart = interval, index = 0; baseStart < battleTime; baseStart += interval, index += 1) {
      const delay = Math.max(0, Number(setting.delays?.[index]) || 0);
      totalDelay += delay;
      const start = Math.min(battleTime, baseStart + totalDelay);
      const clippedDuration = Math.min(duration, battleTime - start);
      if (clippedDuration <= 0) continue;
      events.push({
        id: `ns-${lane.key}-${index}`,
        kind: "NS",
        title: `${lane.name} NS`,
        laneKey: lane.key,
        nsIndex: index,
        characterName: lane.name,
        characterId: lane.id === "-" ? null : lane.id,
        baseStart,
        delay,
        totalDelay,
        elapsedTime: start,
        remainTime: battleTime - start,
        interval,
        duration: clippedDuration,
      });
    }
    return events;
  }

  function getNsSetting(laneKey) {
    return {
      interval: Number(nsSettings[laneKey]?.interval) || 0,
      duration: Number(nsSettings[laneKey]?.duration) || 0,
      delays: normalizeDelayMap(nsSettings[laneKey]?.delays),
    };
  }

  function handleNsDelayInput(event) {
    const input = event.target.closest?.("input[data-ns-delay-input]");
    if (!input) return;

    const laneKey = input.dataset.laneKey;
    const nsIndex = input.dataset.nsIndex;
    const setting = getNsSetting(laneKey);
    const delay = parseSecondsInput(input.value);

    if (delay > 0) {
      setting.delays[nsIndex] = delay;
    } else {
      delete setting.delays[nsIndex];
    }
    nsSettings[laneKey] = setting;

    if (currentTimeline) {
      scheduleNsLayerRender(laneKey);
      selectedEventId = `ns-${laneKey}-${nsIndex}`;
      syncSelection();
    }

    writeNsSettings(nsSettings);
  }

  function readNsSettings() {
    try {
      const parsed = JSON.parse(readLocalSetting(nsStorageKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeNsSettings(settings) {
    writeLocalSetting(nsStorageKey, JSON.stringify(settings));
  }

  function readLocalSetting(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function writeLocalSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Persistence is optional; the visible timeline should still update.
    }
  }

  function handleExLabelModeChange(event) {
    exLabelMode = event.target.value === "time" ? "time" : "cost";
    writeLocalSetting(exLabelModeStorageKey, exLabelMode);

    if (currentTimeline) {
      renderChart(currentTimeline);
      hideDetails();
      syncSelection();
    }
  }

  function readExLabelMode() {
    const value = readLocalSetting(exLabelModeStorageKey);
    return value === "time" ? "time" : "cost";
  }

  function formatExIconLabel(event) {
    if (exLabelMode === "time") {
      return formatSeconds(event.remainTime);
    }

    return formatNumber(event.remainCost, "-");
  }

  function normalizeDelayMap(delays) {
    if (!delays || typeof delays !== "object") return {};

    return Object.fromEntries(
      Object.entries(delays)
        .map(([key, value]) => [key, Math.max(0, Number(value) || 0)])
        .filter(([, value]) => value > 0)
    );
  }

  return {
    render,
    showEmpty,
  };
}

function formatSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const fraction = safeSeconds % 1;
  const secondText = fraction > 0
    ? (seconds + fraction).toFixed(1).padStart(4, "0")
    : String(seconds).padStart(2, "0");
  return `${minutes}:${secondText}`;
}

function formatNumber(value, fallback) {
  if (!Number.isFinite(Number(value))) return fallback;
  return Number(value).toFixed(1).replace(/\.0$/, "");
}

function formatCost(event) {
  const remain = formatNumber(event.remainCost, "-");
  const override = formatNumber(event.overrideCost, "-");
  return event.overrideCost === null ? remain : `${remain} / ${override}`;
}

function formatType(event) {
  if (event.kind === "NS") return "NS";
  return event.typeIndex === 1 ? event.eventTypeName : event.typeName;
}

function formatNsLabel(event) {
  return event.totalDelay > 0 ? `NS +${formatNumber(event.totalDelay, "0")}s` : "NS";
}

function formatChipTitle(event) {
  const cost = formatNumber(event.remainCost, "");
  const suffix = cost ? ` C${cost}` : "";
  return `${event.title}${suffix}`;
}

function renderLaneIcon(lane) {
  return renderIconImage(lane, "lane-icon");
}

function formatInputNumber(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "";
  return String(Number(value)).replace(/\.0$/, "");
}

function parseSecondsInput(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ".")
    .replace(/,/g, ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function renderIconImage(item, className) {
  if (!item.iconUrl) {
    return `<span class="${className} icon-fallback">${escapeHtml((item.name || item.characterName || "?").slice(0, 1) || "?")}</span>`;
  }

  const label = item.name || item.characterName || item.title || "character";
  return `<img class="${className}" src="${escapeHtml(item.iconUrl)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.outerHTML='&lt;span class=&quot;${className} icon-fallback&quot;&gt;?&lt;/span&gt;'">`;
}

function chooseAxisStep(battleTime) {
  if (battleTime <= 60) return 10;
  if (battleTime <= 180) return 30;
  if (battleTime <= 360) return 60;
  return 120;
}

function getAxisIntervalCount(battleTime) {
  return Math.max(1, Math.ceil(battleTime / chooseAxisStep(battleTime)));
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function escapeHtml(value) {
  return (value === null || value === undefined ? "" : String(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
