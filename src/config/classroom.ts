export const classroomEnabled =
  import.meta.env.DEV || import.meta.env.VITE_CLASSROOM_ENABLED === "true";
export const participationEnabled =
  classroomEnabled && import.meta.env.VITE_S10_ENABLED === "true";
