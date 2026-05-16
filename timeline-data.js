"use strict";

const TimelineData = (() => {
  const characterIconDirectory = "assets/character-icons";
  const itemTypes = ["EX", "Event"];
  const eventTypes = ["None", "Down", "RadiatorOn", "RadiatorStop", "Index"];
  const laneColors = [
    "#2764d8",
    "#168270",
    "#7552c7",
    "#be4b78",
    "#397d2f",
    "#8a5a13",
    "#1f799b",
    "#9b4d2e",
  ];

  function parse(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error("JSON が空です。BlueArchivePlayingTool の Export 内容を貼り付けてください。");
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`JSON の解析に失敗しました: ${error.message}`);
    }

    if (Array.isArray(parsed?.TimeLineDatas)) {
      if (parsed.TimeLineDatas.length === 0) {
        throw new Error("TimeLineDataList にタイムラインが含まれていません。");
      }
      return parsed.TimeLineDatas[0];
    }

    if (parsed?.TimeLineData && typeof parsed.TimeLineData === "object") {
      return parsed.TimeLineData;
    }

    return parsed;
  }

  function normalize(timeline) {
    if (!timeline || typeof timeline !== "object") {
      throw new Error("TimeLineData オブジェクトを読み取れませんでした。");
    }

    if (!Array.isArray(timeline.TimeLineEvents)) {
      throw new Error("TimeLineEvents が見つかりません。TimeLineData の JSON を貼り付けてください。");
    }

    if (timeline.TimeLineEvents.length === 0) {
      throw new Error("TimeLineEvents が空です。表示できるイベントがありません。");
    }

    const battleTime = clampNumber(timeline.Time, 180, 1, 9999);
    const organizedCharacters = Array.isArray(timeline.OrganaizedCharacterList)
      ? timeline.OrganaizedCharacterList.filter(Boolean)
      : [];

    const lanes = buildLanes(organizedCharacters, timeline.TimeLineEvents);
    const laneColorMap = new Map(lanes.map((lane, index) => [lane.key, laneColors[index % laneColors.length]]));

    const events = timeline.TimeLineEvents
      .map((event, index) => normalizeEvent(event, index, battleTime, laneColorMap))
      .sort((a, b) => a.elapsedTime - b.elapsedTime || a.index - b.index);

    return {
      name: safeText(timeline.Name) || "タイムライン",
      bossId: Number.isFinite(Number(timeline.BossId)) ? Number(timeline.BossId) : 0,
      battleTime,
      organizedCount: organizedCharacters.filter((character) => safeText(character?.Name)).length,
      lanes,
      events,
    };
  }

  function buildLanes(organizedCharacters, events) {
    const laneMap = new Map();
    const lanes = [];

    organizedCharacters.forEach((character, index) => {
      const name = safeText(character?.Name);
      if (!name) return;
      const key = getCharacterKey(character, `organized-${index}`);
      addLane(laneMap, lanes, key, character, "編成");
    });

    events.forEach((event, index) => {
      const character = event?.CharacterData;
      const name = safeText(character?.Name) || safeText(event?.Description);
      if (!name) return;
      const key = getCharacterKey(character, `event-${index}`);
      addLane(laneMap, lanes, key, character, "イベント");
    });

    if (lanes.length === 0) {
      lanes.push({
        key: "unknown",
        id: "-",
        name: "未指定",
        cost: null,
        source: "イベント",
      });
    }

    return lanes;
  }

  function addLane(laneMap, lanes, key, character, source) {
    if (laneMap.has(key)) return;

    const lane = {
      key,
      id: Number.isFinite(Number(character?.Id)) ? Number(character.Id) : "-",
      name: safeText(character?.Name) || "未指定",
      iconName: safeText(character?.IconName),
      iconUrl: getIconUrl(character),
      cost: Number.isFinite(Number(character?.Cost)) ? Number(character.Cost) : null,
      source,
    };
    laneMap.set(key, lane);
    lanes.push(lane);
  }

  function normalizeEvent(event, index, battleTime, laneColorMap) {
    const character = event?.CharacterData || {};
    const laneKey = getCharacterKey(character, safeText(event?.Description) ? `desc-${event.Description}` : "unknown");
    const itemTypeIndex = toInteger(event?.ItemType, 0);
    const eventTypeIndex = toInteger(event?.EventType, 0);
    const remainTime = clampNumber(event?.RemainTime, battleTime, 0, battleTime);
    const elapsedTime = battleTime - remainTime;
    const typeName = itemTypes[itemTypeIndex] || `Type ${itemTypeIndex}`;
    const eventTypeName = eventTypes[eventTypeIndex] || `Event ${eventTypeIndex}`;
    const description = safeText(event?.Description);
    const characterName = safeText(character?.Name) || "未指定";
    const exEffectTime = Math.max(0, toOptionalNumber(character?.ExEffectTime) || 0);
    const title = itemTypeIndex === 0
      ? characterName
      : description || eventTypeName;

    return {
      id: `event-${index}`,
      index,
      laneKey,
      title,
      characterName,
      characterId: Number.isFinite(Number(character?.Id)) ? Number(character.Id) : null,
      iconName: safeText(character?.IconName),
      iconUrl: getIconUrl(character),
      exEffectTime,
      typeIndex: itemTypeIndex,
      typeName,
      eventTypeName,
      description,
      remainTime,
      elapsedTime,
      waitTime: toOptionalNumber(event?.WaitTime),
      remainCost: toOptionalNumber(event?.RemainCost),
      overrideCost: toOptionalNumber(event?.OverrideCost),
      targetId: Number.isFinite(Number(event?.TargetId)) ? Number(event.TargetId) : null,
      canUsable: event?.CanUsable !== false,
      isOverrideCostSet: Boolean(event?.IsOverrideCostSet),
      isSelf: Boolean(event?.IsSelf),
      color: laneColorMap.get(laneKey) || laneColors[index % laneColors.length],
    };
  }

  function getCharacterKey(character, fallback) {
    const id = Number(character?.Id);
    if (Number.isFinite(id) && id >= 0) return `id:${id}`;
    const name = safeText(character?.Name);
    if (name) return `name:${name}`;
    return fallback || "unknown";
  }

  function getIconUrl(character) {
    const iconName = safeText(character?.IconName);
    if (!iconName) return "";

    const filename = iconName.endsWith(".png") ? iconName : `${iconName}.png`;
    return `${characterIconDirectory}/${encodeURIComponent(filename)}`;
  }

  function safeText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function toInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  }

  function toOptionalNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  return {
    parse,
    normalize,
  };
})();
