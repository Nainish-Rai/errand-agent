import { Skeleton } from "@/components/skeleton";

// The Suspense boundary every page renders inside. Pages read the request (search params, route
// params) and the current time, which cacheComponents allows only under Suspense, so the production
// build can prerender the shell and stream the page into it.
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
