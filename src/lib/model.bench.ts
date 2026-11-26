/**
 * Frontend hot-path benchmarks (Vitest bench, Vitest 5 fixture API).
 *
 * Run with `npm run bench`. They exercise the pure functions that run on
 * every keystroke / render with a worst-case list (5k projects) so the
 * numbers stay meaningful on a large base folder.
 */
import { test } from "vitest";
import {
  applyDisabledFilter,
  filterProjects,
  getVisibleProjects,
  isProjectDisabled,
  sortProjects,
  type Project,
} from "./model";

function projects(count: number): Project[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Project-${String(i).padStart(4, "0")}`,
    path: `/Users/you/Programs/batch-${String(i % 8)}/Project-${String(i).padStart(4, "0")}`,
    base: `/Users/you/Programs/batch-${String(i % 8)}`,
  }));
}

const LIST = projects(5_000);
const DISABLED = Array.from(
  { length: 100 },
  (_, i) => `/Users/you/Programs/batch-${String(i % 8)}/Project-${String(i).padStart(4, "0")}`,
);

// Local aliases: Vitest's module runner wraps imports in getters and that
// overhead would otherwise show up in the 5k loop.
const sort = sortProjects;
const filter = filterProjects;
const visibleProjects = getVisibleProjects;
const applyFilter = applyDisabledFilter;
const isDisabled = isProjectDisabled;

// Consume results so the JIT cannot eliminate the work.
let sink: unknown;
const keep = (value: unknown): void => {
  sink = value;
};

test("model hot paths (5k projects)", async ({ bench }) => {
  await bench.compare(
    bench("sortProjects (name)", () => {
      keep(sort(LIST, "name"));
    }),
    bench("sortProjects (base)", () => {
      keep(sort(LIST, "base"));
    }),
    bench("filterProjects (query hit)", () => {
      keep(filter(LIST, "project-1"));
    }),
    bench("getVisibleProjects (base + query)", () => {
      keep(visibleProjects(LIST, "project-1", "base"));
    }),
    bench("applyDisabledFilter (100 disabled)", () => {
      keep(applyFilter(LIST, DISABLED));
    }),
    bench("isProjectDisabled (100 disabled, hit)", () => {
      keep(isDisabled(LIST[0]!.path, DISABLED));
    }),
    bench("isProjectDisabled (100 disabled, miss)", () => {
      keep(isDisabled(LIST[LIST.length - 1]!.path, DISABLED));
    }),
    {
      iterations: 50,
      time: 500,
    },
  );
  // Read the sink once so TypeScript and the JIT both see it as live.
  void sink;
});
