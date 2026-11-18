/// <reference path="../deno.d.ts" />

// Trusted network-time source for ReliableClock (apps/pos/src/lib/time/clock.ts).
// Deliberately returns the timestamp in the JSON BODY, not a `Date` response
// header: `Date` is not a CORS-safelisted response header, so a cross-origin
// browser fetch() (till app on a different origin/port than Supabase) cannot
// read it via response.headers.get("date") unless the server also sends
// `Access-Control-Expose-Headers: Date` — which Supabase's own Kong/GoTrue
// endpoints do not. Response bodies have no such restriction.
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-client-info, apikey",
  "access-control-allow-methods": "GET, OPTIONS",
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ now: new Date().toISOString() }), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
