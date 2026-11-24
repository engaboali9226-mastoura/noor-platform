import type {
  UserId,
} from "../identity/user-id.js";

import type {
  AuthenticationAccountId,
} from "./authentication-account-id.js";

export class VerifiedAuthentication {
  readonly #originatingAuthSessionId: string | undefined;

  /** Server-only, from the cryptographically verified provider proof. */
  public get originatingAuthSessionId(): string | undefined {
    return this.#originatingAuthSessionId;
  }

  public constructor(
    public readonly accountId:
      AuthenticationAccountId,
    public readonly userId:
      UserId,
    originatingAuthSessionId?: string,
  ) {
    if (originatingAuthSessionId !== undefined
      && (typeof originatingAuthSessionId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(originatingAuthSessionId))) {
      throw new TypeError("Invalid originating Auth session identity.");
    }
    this.#originatingAuthSessionId = originatingAuthSessionId;

    Object.freeze(
      this,
    );

  }

}
