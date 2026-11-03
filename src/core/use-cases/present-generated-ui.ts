import { judgePresentedUi, type GeneratedUiVerdict } from "../generated-ui/generated-ui";
import { traceVerdict, unknownIdsIn, type GeneratedUiDependencies, type GeneratedUiRequest } from "./generated-ui-session";

// PresentGeneratedUi: judge a program that shows something (cards, charts, details, next-step
// chips). The chat draws it only when the verdict is drawable; otherwise the reply's text stands.

export async function presentGeneratedUi(deps: GeneratedUiDependencies, request: GeneratedUiRequest): Promise<GeneratedUiVerdict> {
  const reading = deps.reader.read(request.program);
  const verdict = judgePresentedUi(reading, await unknownIdsIn(deps, reading, request.userId));
  await traceVerdict(deps, request.place, "present", verdict);
  return verdict;
}
