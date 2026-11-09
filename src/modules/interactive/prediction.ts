export const predictionLimits = {
  question: 500,
  option: 180,
  notes: 5_000,
  options: 5,
  manualCount: 10_000,
} as const;

const phases = [
  "draft",
  "predicting",
  "locked",
  "observing",
  "explaining",
  "completed",
] as const;
export type PredictionPhase = (typeof phases)[number];
export type PredictionToken = { epoch: number; revision: number };
export type PredictionOption = {
  id: string;
  text: string;
  manualCount: number;
};
export type PredictionRound = PredictionToken & {
  schemaVersion: 1;
  phase: PredictionPhase;
  question: string;
  options: PredictionOption[];
  teacherNotes: string;
  observation: string;
  explanation: string;
};
export type PredictionInput = {
  question: string;
  options: readonly string[];
  teacherNotes?: string;
};
export type PredictionAction =
  | { type: "configure"; input: PredictionInput }
  | { type: "start" }
  | { type: "tally"; optionId: string; delta: -1 | 1 }
  | { type: "lock" }
  | { type: "observe" }
  | { type: "explain" }
  | { type: "record"; observation?: string; explanation?: string }
  | { type: "complete" }
  | { type: "reset" };

const invalid = (message: string): never => {
  throw new Error(message);
};

function record(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(value, key))
  )
    return invalid("Dữ liệu hoạt động không đúng định dạng.");
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  name: string,
  limit: number,
  required: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    return invalid(`${name} phải là văn bản dài tối đa ${limit} ký tự.`);
  const cleaned = value.replace(/\r\n?/g, "\n").trim();
  if (required && !cleaned) return invalid(`${name} không được để trống.`);
  return cleaned;
}

function retainedText(
  value: unknown,
  name: string,
  limit: number,
  required: boolean,
): string {
  const cleaned = text(value, name, limit, required);
  if (cleaned !== value)
    return invalid(`${name} có định dạng văn bản không hợp lệ.`);
  return cleaned;
}

function count(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    return invalid("Số lượt hoặc số vòng không hợp lệ.");
  return value;
}

function choiceKey(label: string) {
  return label.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

function optionList(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > predictionLimits.options
  )
    return invalid("Cần từ 2 đến 5 phương án.");
  return Array.from(value);
}

function distinct(options: PredictionOption[]) {
  if (
    new Set(options.map((option) => option.id)).size !== options.length ||
    new Set(options.map((option) => choiceKey(option.text))).size !==
      options.length
  )
    return invalid("Mỗi phương án phải khác nhau.");
  return options;
}

function author(input: PredictionInput) {
  return {
    question: text(input.question, "Câu hỏi", predictionLimits.question, true),
    options: distinct(
      optionList(input.options).map((option, index) => ({
        id: `option-${index + 1}`,
        text: text(
          option,
          `Phương án ${index + 1}`,
          predictionLimits.option,
          true,
        ),
        manualCount: 0,
      })),
    ),
    teacherNotes: text(
      input.teacherNotes ?? "",
      "Ghi chú",
      predictionLimits.notes,
      false,
    ),
  };
}

export function createPrediction(input: PredictionInput): PredictionRound {
  return {
    schemaVersion: 1,
    epoch: 1,
    revision: 0,
    phase: "draft",
    ...author(input),
    observation: "",
    explanation: "",
  };
}

/** Validates the retained record at the shape/archive seam. No activity source is executed. */
export function validatePrediction(input: unknown): PredictionRound {
  const value = record(input, [
    "schemaVersion",
    "epoch",
    "revision",
    "phase",
    "question",
    "options",
    "teacherNotes",
    "observation",
    "explanation",
  ]);
  const phase = phases.find((phase) => phase === value.phase);
  if (value.schemaVersion !== 1 || !phase)
    return invalid("Phiên bản hoặc bước của hoạt động không được hỗ trợ.");
  count(value.epoch, 1);
  count(value.revision, phase === "completed" ? 6 : phases.indexOf(phase));
  retainedText(value.question, "Câu hỏi", predictionLimits.question, true);
  const options = distinct(
    optionList(value.options).map((option, index) => {
      const item = record(option, ["id", "text", "manualCount"]);
      if (typeof item.id !== "string" || !/^option-[1-5]$/.test(item.id))
        return invalid("Mã phương án không hợp lệ.");
      return {
        id: item.id,
        text: retainedText(
          item.text,
          `Phương án ${index + 1}`,
          predictionLimits.option,
          true,
        ),
        manualCount: count(item.manualCount, 0, predictionLimits.manualCount),
      };
    }),
  );
  retainedText(value.teacherNotes, "Ghi chú", predictionLimits.notes, false);
  const observation = retainedText(
    value.observation,
    "Quan sát",
    predictionLimits.notes,
    false,
  );
  const explanation = retainedText(
    value.explanation,
    "Giải thích",
    predictionLimits.notes,
    false,
  );
  if (
    (phase === "draft" && options.some((option) => option.manualCount !== 0)) ||
    (phases.indexOf(phase) < 3 && observation) ||
    (phases.indexOf(phase) < 4 && explanation) ||
    (phase === "completed" && !explanation)
  )
    return invalid("Dữ liệu hoạt động không khớp với bước hiện tại.");
  return value as PredictionRound;
}

export function transitionPrediction(
  value: PredictionRound,
  expected: PredictionToken,
  action: PredictionAction,
): PredictionRound {
  if (value.epoch !== expected.epoch || value.revision !== expected.revision)
    return invalid(
      "Vòng dự đoán đã thay đổi. Hãy kiểm tra lại trước khi tiếp tục.",
    );
  const next = (change: Partial<PredictionRound>) => ({
    ...value,
    ...change,
    revision: count(value.revision + 1, 0),
  });
  const requirePhase = (...allowed: PredictionPhase[]) => {
    if (!allowed.includes(value.phase))
      invalid("Thao tác này không dùng được ở bước hiện tại.");
  };
  switch (action.type) {
    case "configure":
      requirePhase("draft");
      return next(author(action.input));
    case "start":
      requirePhase("draft");
      return next({ phase: "predicting" });
    case "tally": {
      requirePhase("predicting");
      const index = value.options.findIndex(
        (option) => option.id === action.optionId,
      );
      if (index < 0 || (action.delta !== -1 && action.delta !== 1))
        return invalid("Lượt dự đoán không hợp lệ.");
      const options = value.options.slice();
      const option = options[index];
      options[index] = {
        ...option,
        manualCount: count(
          option.manualCount + action.delta,
          0,
          predictionLimits.manualCount,
        ),
      };
      return next({ options });
    }
    case "lock":
      requirePhase("predicting");
      return next({ phase: "locked" });
    case "observe":
      requirePhase("locked");
      return next({ phase: "observing" });
    case "explain":
      requirePhase("observing");
      return next({ phase: "explaining" });
    case "record":
      requirePhase("observing", "explaining");
      if (action.explanation !== undefined) requirePhase("explaining");
      return next({
        observation:
          action.observation === undefined
            ? value.observation
            : text(
                action.observation,
                "Quan sát",
                predictionLimits.notes,
                false,
              ),
        explanation:
          action.explanation === undefined
            ? value.explanation
            : text(
                action.explanation,
                "Giải thích",
                predictionLimits.notes,
                false,
              ),
      });
    case "complete":
      requirePhase("explaining");
      if (!value.explanation)
        return invalid("Hãy lưu lời giải thích trước khi hoàn tất.");
      return next({ phase: "completed" });
    case "reset":
      requirePhase(
        "predicting",
        "locked",
        "observing",
        "explaining",
        "completed",
      );
      return {
        ...value,
        epoch: count(value.epoch + 1, 1),
        revision: 0,
        phase: "draft",
        observation: "",
        explanation: "",
        options: value.options.map((option) => ({ ...option, manualCount: 0 })),
      };
  }
  return invalid("Thao tác hoạt động không được hỗ trợ.");
}

/** Round counts to tenths of a percent with an exact 100% displayed total. */
export function predictionResults(value: PredictionRound) {
  const total = value.options.reduce(
    (sum, option) => sum + option.manualCount,
    0,
  );
  const shares = value.options.map((option, index) => {
    const scaled = option.manualCount * 1_000;
    return {
      index,
      units: total ? Math.floor(scaled / total) : 0,
      remainder: total ? scaled % total : 0,
    };
  });
  if (total) {
    const remaining =
      1_000 - shares.reduce((sum, share) => sum + share.units, 0);
    const ordered = shares
      .slice()
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < remaining; i++) ordered[i].units++;
  }
  return {
    total,
    options: value.options.map((option, index) => ({
      ...option,
      percentage: shares[index].units / 10,
    })),
  };
}
