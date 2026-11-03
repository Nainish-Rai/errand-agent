import { missingFields, REQUIRED_FIELDS } from "../errand/errand";
import { judgeAskedUi, type GeneratedUiVerdict } from "../generated-ui/generated-ui";
import { traceVerdict, unknownIdsIn, type GeneratedUiDependencies, type GeneratedUiRequest } from "./generated-ui-session";

// AskWithGeneratedUi: judge a program that asks the person something (missing details, a slot,
// one of a few options). It grants nothing: the answer comes back as the person's next message
// and goes through the same checks as anything they type.

export async function askWithGeneratedUi(deps: GeneratedUiDependencies, request: GeneratedUiRequest): Promise<GeneratedUiVerdict> {
  const reading = deps.reader.read(request.program);
  const errand = await deps.errands.find(request.place.sessionId);
  const missing = errand === undefined ? [...REQUIRED_FIELDS] : missingFields(errand.details);
  const verdict = judgeAskedUi(reading, await unknownIdsIn(deps, reading, request.userId), missing);
  await traceVerdict(deps, request.place, "ask", verdict);
  return verdict;
}
