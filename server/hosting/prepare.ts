import { prepareClassroomEnvironment } from "./environment.ts";

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1 || arguments_.some(value => !value.startsWith("--google-client-file=") || !value.slice("--google-client-file=".length)))
    throw new Error("Use only --google-client-file=<path>.");
  const result = await prepareClassroomEnvironment({
    directory: process.cwd(),
    googleClientFile: arguments_[0]?.slice("--google-client-file=".length),
  });
  console.log("Prepared ignored .env.local and render-env.local.txt.");
  if (result.missing.length) {
    console.log("Configuration still required: " + result.missing.join(", "));
    process.exitCode = 1;
  }
} catch {
  console.error("Classroom environment preparation failed. Check existing files and the selected Google Web Application configuration.");
  process.exitCode = 1;
}
