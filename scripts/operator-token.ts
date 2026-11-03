import { mintAccessToken } from "@errand/client";

// Prints an access token for the operator console (/ops), signed with the ERRAND_AUTH_SECRET the
// backend runs with. The id must be on the backend's ERRAND_OPERATOR_IDS for the token to open the
// console; any other id signs in as an ordinary person. The secret comes from the environment only
// (see the README, "Operator console"); this script never writes it or the token anywhere.
//
//   ERRAND_AUTH_SECRET="$(security find-generic-password -s errand-agent-auth -w)" pnpm -s operator-token you

const subject = process.argv.slice(2).find((argument) => argument !== "--");
const secret = process.env.ERRAND_AUTH_SECRET?.trim();
if (subject === undefined || subject === "") {
  console.error("Usage: pnpm -s operator-token OPERATOR_ID (with ERRAND_AUTH_SECRET set, as for the backend)");
  process.exit(2);
}
if (secret === undefined || secret === "") {
  console.error("ERRAND_AUTH_SECRET is unset: run this with the same secret the backend has.");
  process.exit(2);
}
console.log(await mintAccessToken({ secret, subject }));
