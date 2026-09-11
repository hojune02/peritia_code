export type User = {
  id: string;
  email: string;
  password: string | null;
  google_sub: string | null;
};

export type OAuthTransaction = {
  nonce: string;
  verifier: string;
};

type MaybePromise<T> = T | Promise<T>;

export interface AuthStore {
  byEmail(email: string): MaybePromise<User | undefined>;

  byGoogle(sub: string): MaybePromise<User | undefined>;

  createUser(
    email: string,
    password: string | null,
    sub?: string | null,
  ): MaybePromise<User>;

  session(
    id: string,
    userId: string,
    expires: number,
  ): MaybePromise<void>;

  sessionUser(
    id: string,
    userId: string,
    now: number,
  ): MaybePromise<User | undefined>;

  revoke(id: string): MaybePromise<void>;

  saveOAuth(
    state: string,
    browser: string,
    nonce: string,
    verifier: string,
  ): MaybePromise<void>;

  takeOAuth(
    state: string,
    browser: string,
  ): MaybePromise<OAuthTransaction | undefined>;

  prune(): MaybePromise<void>;

  close(): MaybePromise<void>;
}