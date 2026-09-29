/** Public profile of the blog's actor. */

export interface ActorProfileField {
  name: string;
  /** Absolute URL, rendered as a link in the profile metadata table. */
  url: string;
}

export interface ActorProfile {
  name: string;
  summary: string;
  /** Absolute URL to the actor avatar (global favicon), or null. */
  iconUrl: string | null;
  /** Absolute URL to the profile header image (global fediverseHeader), or null. */
  headerUrl: string | null;
  /** Human-facing page for the actor: the frontend home page. */
  url: string;
  fields: ActorProfileField[];
}
