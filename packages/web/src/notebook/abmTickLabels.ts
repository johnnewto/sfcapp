export type AbmTickKind = "do" | "for" | "hire-lottery" | "shuffle" | "ration-fcfs";

/** Display labels for ABM tick operations (Visual editor + run/publish view). */
export function abmTickKindLabel(kind: AbmTickKind): string {
  switch (kind) {
    case "do":
      return "Do";
    case "for":
      return "For";
    case "hire-lottery":
      return "Hire lottery";
    case "shuffle":
      return "Shuffle";
    case "ration-fcfs":
      return "Ration FCFS";
  }
}
