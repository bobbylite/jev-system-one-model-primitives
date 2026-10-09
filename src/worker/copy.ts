/** Strings the UI shows in the error box. `detail` is already what the client reads. */
export class PublicCopy {
  private constructor() {}

  static readonly switchedOff = "Jev is switched off until an API key is set.";
  static readonly resting = "Jev is resting until tomorrow (UTC).";
  static readonly busy = "Jev is busy right now. Try again in a moment.";
  static readonly unavailable = "Jev is unavailable right now. Try again in a moment.";
  static readonly rateLimit = "Too many requests from this network. Try again in a bit.";
}
