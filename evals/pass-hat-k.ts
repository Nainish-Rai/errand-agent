// pass^k from τ-bench: the chance that k trials drawn from n all pass, given c of the n passed.
// pass^k = C(c, k) / C(n, k). pass^1 is the plain pass rate; a larger k asks for consistency.

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
}

export function passHatK(passed: number, trials: number, k: number): number {
  if (!Number.isInteger(passed) || !Number.isInteger(trials) || !Number.isInteger(k)) {
    throw new RangeError("pass^k takes whole numbers.");
  }
  if (trials < 1 || k < 1 || k > trials || passed < 0 || passed > trials) {
    throw new RangeError(`pass^k needs 0 ≤ passed ≤ trials and 1 ≤ k ≤ trials; got passed=${passed}, trials=${trials}, k=${k}.`);
  }
  return combinations(passed, k) / combinations(trials, k);
}
