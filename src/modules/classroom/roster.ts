export const MAX_CALLER_LEARNERS = 300;
export const MAX_CALLER_IMPORT_BYTES = 500_000;
export const MAX_CALLER_NAME = 80;
export const MAX_CALLER_TITLE = 120;
const MAX_CYCLE_MEMBERS = 1_200;

export type DrawCount = 1 | 2 | 3 | 4;
export type CallerLearner = { id: string; name: string };
export type CallerResult = {
  id: string;
  requested: DrawCount;
  learners: CallerLearner[];
  at: number;
};
export type CallerClass = {
  version: 1;
  id: string;
  title: string;
  learners: CallerLearner[];
  cycle: { id: string; memberIds: string[]; usedIds: string[] };
  drawCount: DrawCount;
  result: CallerResult | null;
  updatedAt: number;
  source?: { roomId: string };
};
type MakeId = () => string;
type HostedRoster = {
  id: string;
  title: string;
  participants: readonly {
    id: string;
    displayName: string;
    position: number;
  }[];
};

const makeId = () => crypto.randomUUID();
const randomWord = () => crypto.getRandomValues(new Uint32Array(1))[0];
const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const isDate = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validName = (value: unknown, max = MAX_CALLER_NAME): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max * 2 &&
  Array.from(value).length <= max &&
  !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);

function name(raw: string, max = MAX_CALLER_NAME) {
  const value = raw.normalize("NFC").trim();
  if (!validName(value, max))
    throw new Error(
      "Tên cần có từ 1 đến " + max + " ký tự và nằm trên một dòng.",
    );
  return value;
}

export function isDrawCount(value: unknown): value is DrawCount {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function validLearners(value: unknown, max: number): value is CallerLearner[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every(
      (learner) =>
        isObject(learner) && isId(learner.id) && validName(learner.name),
    ) &&
    new Set(value.map((learner) => learner.id)).size === value.length
  );
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CYCLE_MEMBERS &&
    value.every(isId) &&
    new Set(value).size === value.length
  );
}

export function validateCallerClass(value: unknown): CallerClass {
  const invalid = () =>
    new Error("Danh sách hoặc lượt gọi có dữ liệu không hợp lệ.");
  if (!isObject(value) || value.version !== 1) {
    throw new Error("Phiên bản danh sách học sinh chưa được hỗ trợ.");
  }
  const { id, title, learners, cycle, drawCount, result, updatedAt, source } =
    value;
  if (
    !isId(id) ||
    !validName(title, MAX_CALLER_TITLE) ||
    !validLearners(learners, MAX_CALLER_LEARNERS) ||
    !isObject(cycle) ||
    !isId(cycle.id) ||
    !validIds(cycle.memberIds) ||
    !validIds(cycle.usedIds) ||
    !isDrawCount(drawCount) ||
    !isDate(updatedAt) ||
    (source !== undefined && (!isObject(source) || !isId(source.roomId)))
  )
    throw invalid();

  const members = new Set(cycle.memberIds);
  const used = new Set(cycle.usedIds);
  if (
    learners.some((learner) => !members.has(learner.id)) ||
    cycle.usedIds.some((usedId) => !members.has(usedId))
  )
    throw invalid();

  let checkedResult: CallerResult | null = null;
  if (result !== null) {
    if (
      !isObject(result) ||
      !isId(result.id) ||
      !isDrawCount(result.requested) ||
      !validLearners(result.learners, result.requested) ||
      !result.learners.length ||
      result.learners.some((learner) => !used.has(learner.id)) ||
      !isDate(result.at)
    )
      throw invalid();
    checkedResult = {
      id: result.id,
      requested: result.requested,
      learners: result.learners.map(({ id, name }) => ({ id, name })),
      at: result.at,
    };
  }

  return {
    version: 1,
    id,
    title,
    learners: learners.map(({ id, name }) => ({ id, name })),
    cycle: {
      id: cycle.id,
      memberIds: [...cycle.memberIds],
      usedIds: [...cycle.usedIds],
    },
    drawCount,
    result: checkedResult,
    updatedAt,
    ...(source ? { source: { roomId: source.roomId as string } } : {}),
  };
}

export function createCallerClass(
  title: string,
  names: readonly string[] = [],
  id: MakeId = makeId,
  now = Date.now(),
): CallerClass {
  if (names.length > MAX_CALLER_LEARNERS)
    throw new Error("Mỗi lớp có tối đa 300 học sinh.");
  const learners = names.map((value) => ({ id: id(), name: name(value) }));
  return validateCallerClass({
    version: 1,
    id: id(),
    title: name(title, MAX_CALLER_TITLE),
    learners,
    cycle: {
      id: id(),
      memberIds: learners.map((learner) => learner.id),
      usedIds: [],
    },
    drawCount: 1,
    result: null,
    updatedAt: now,
  });
}

function updateRoster(
  list: CallerClass,
  learners: CallerLearner[],
  now: number,
): CallerClass {
  if (learners.length > MAX_CALLER_LEARNERS)
    throw new Error("Mỗi lớp có tối đa 300 học sinh.");
  const memberIds = [
    ...new Set([
      ...list.cycle.memberIds,
      ...learners.map((learner) => learner.id),
    ]),
  ];
  if (memberIds.length > MAX_CYCLE_MEMBERS)
    throw new Error(
      "Lượt gọi đã có nhiều thay đổi. Hãy bắt đầu lượt mới trước khi thêm học sinh.",
    );
  return {
    ...list,
    learners,
    cycle: { ...list.cycle, memberIds },
    updatedAt: now,
  };
}

export function appendNames(
  list: CallerClass,
  names: readonly string[],
  id: MakeId = makeId,
  now = Date.now(),
): CallerClass {
  if (list.learners.length + names.length > MAX_CALLER_LEARNERS) {
    throw new Error("Mỗi lớp có tối đa 300 học sinh.");
  }
  return updateRoster(
    list,
    [
      ...list.learners,
      ...names.map((value) => ({ id: id(), name: name(value) })),
    ],
    now,
  );
}

export function editLearner(
  list: CallerClass,
  id: string,
  value: string,
  now = Date.now(),
): CallerClass {
  const checked = name(value);
  return updateRoster(
    list,
    list.learners.map((learner) =>
      learner.id === id ? { id, name: checked } : learner,
    ),
    now,
  );
}

export function reorderLearner(
  list: CallerClass,
  id: string,
  index: number,
  now = Date.now(),
): CallerClass {
  const from = list.learners.findIndex((learner) => learner.id === id);
  if (
    from < 0 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= list.learners.length ||
    index === from
  )
    return list;
  const learners = [...list.learners];
  learners.splice(index, 0, ...learners.splice(from, 1));
  return updateRoster(list, learners, now);
}

export function removeLearner(
  list: CallerClass,
  id: string,
  now = Date.now(),
): CallerClass {
  return updateRoster(
    list,
    list.learners.filter((learner) => learner.id !== id),
    now,
  );
}

export function renameCallerClass(
  list: CallerClass,
  title: string,
  now = Date.now(),
): CallerClass {
  return { ...list, title: name(title, MAX_CALLER_TITLE), updatedAt: now };
}

export function resetCallerCycle(
  list: CallerClass,
  id: MakeId = makeId,
  now = Date.now(),
): CallerClass {
  return {
    ...list,
    cycle: {
      id: id(),
      memberIds: list.learners.map((learner) => learner.id),
      usedIds: [],
    },
    result: null,
    updatedAt: now,
  };
}

export function eligibleLearners(list: CallerClass): CallerLearner[] {
  const used = new Set(list.cycle.usedIds);
  return list.learners.filter((learner) => !used.has(learner.id));
}

/** Discard the uneven upper range before taking a remainder. */
export function randomInteger(bound: number, readWord = randomWord): number {
  const space = 0x1_0000_0000;
  if (!Number.isInteger(bound) || bound < 1 || bound > space)
    throw new RangeError("Khoảng chọn ngẫu nhiên không hợp lệ.");
  const limit = space - (space % bound);
  let word: number;
  do {
    word = readWord();
    if (!Number.isInteger(word) || word < 0 || word >= space)
      throw new RangeError("Random word is outside uint32 range.");
  } while (word >= limit);
  return word % bound;
}

export function drawLearners(
  list: CallerClass,
  count: DrawCount,
  random = randomInteger,
  id: MakeId = makeId,
  now = Date.now(),
): CallerClass {
  if (!isDrawCount(count)) throw new Error("Chọn từ 1 đến 4 học sinh.");
  const eligible = eligibleLearners(list);
  if (!eligible.length)
    throw new Error("Đã hết lượt gọi. Hãy bắt đầu lượt mới.");
  const size = Math.min(count, eligible.length);
  // Fisher–Yates prefix samples uniformly without replacing any learner.
  for (let i = 0; i < size; i++) {
    const range = eligible.length - i;
    const offset = random(range);
    if (!Number.isInteger(offset) || offset < 0 || offset >= range)
      throw new RangeError("Khoảng chọn ngẫu nhiên không hợp lệ.");
    const j = i + offset;
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const learners = eligible.slice(0, size);
  return {
    ...list,
    drawCount: count,
    result: { id: id(), requested: count, learners, at: now },
    cycle: {
      ...list.cycle,
      usedIds: [
        ...list.cycle.usedIds,
        ...learners.map((learner) => learner.id),
      ],
    },
    updatedAt: now,
  };
}

export function importRoomRoster(
  room: HostedRoster,
  id: MakeId = makeId,
  now = Date.now(),
  existing?: CallerClass,
): CallerClass {
  const learners = [...room.participants]
    .sort((a, b) => a.position - b.position)
    .map((participant) => ({
      id: participant.id,
      name: name(participant.displayName),
    }));
  const list =
    existing?.source?.roomId === room.id
      ? existing
      : createCallerClass(room.title, [], id, now);
  return validateCallerClass({
    ...updateRoster(list, learners, now),
    title: name(room.title, MAX_CALLER_TITLE),
    source: { roomId: room.id },
  });
}

export function importCallerClass(
  list: CallerClass,
  id: MakeId = makeId,
  now = Date.now(),
): CallerClass {
  return { ...validateCallerClass(list), id: id(), updatedAt: now };
}

export function exportCallerClass(list: CallerClass): string {
  return JSON.stringify(
    {
      format: "lessonboard-caller",
      version: 1,
      class: validateCallerClass(list),
    },
    null,
    2,
  );
}

export function parseRosterImport(
  input: string,
  fileName: string,
): { kind: "class"; value: CallerClass } | { kind: "names"; names: string[] } {
  if (new TextEncoder().encode(input).length > MAX_CALLER_IMPORT_BYTES)
    throw new Error("Tệp danh sách vượt quá 500 KB.");
  const source = input.replace(/^\ufeff/, "");
  if (/\.json$/i.test(fileName)) {
    let data: unknown;
    try {
      data = JSON.parse(source);
    } catch {
      throw new Error("Không đọc được tệp JSON danh sách.");
    }
    if (
      !isObject(data) ||
      data.format !== "lessonboard-caller" ||
      data.version !== 1
    )
      throw new Error("Tệp sao lưu danh sách chưa được hỗ trợ.");
    return { kind: "class", value: validateCallerClass(data.class) };
  }
  if (!/\.(txt|csv)$/i.test(fileName))
    throw new Error("Chọn tệp TXT, CSV một cột hoặc bản sao JSON.");
  const csv = /\.csv$/i.test(fileName);
  const lines = source
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const names = lines.map((line) => {
    if (!csv) return name(line);
    const quoted = /^"((?:[^"]|"")*)"$/.exec(line);
    if (quoted) return name(quoted[1].replaceAll('""', '"'));
    if (/[",]/.test(line))
      throw new Error("CSV phải có một cột tên và mỗi tên nằm trên một dòng.");
    return name(line);
  });
  if (csv && /^(name|displayname|họ và tên|tên)$/iu.test(names[0] ?? ""))
    names.shift();
  if (!names.length || names.length > MAX_CALLER_LEARNERS)
    throw new Error("Danh sách cần có từ 1 đến 300 học sinh.");
  return { kind: "names", names };
}
