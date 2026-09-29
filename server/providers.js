import { randomUUID } from "node:crypto";
const plain = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export async function searchJobs(query, location, env) {
  const jobs = [],
    errors = [];
  try {
    const res = await fetch(
      "https://remotive.com/api/remote-jobs?search=" +
        encodeURIComponent(query),
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) throw new Error();
    const data = await res.json();
    for (const j of (data.jobs || []).slice(0, 35))
      jobs.push({
        id: "remotive-" + j.id,
        title: j.title,
        company: j.company_name,
        location:
          j.candidate_required_location || "Remote (eligibility unspecified)",
        description: plain(j.description),
        salary: j.salary || "",
        url: j.url,
        remote: true,
        tags: j.tags || [],
        source: "Remotive",
        postedAt: j.publication_date,
        sample: false,
      });
  } catch {
    errors.push("Remotive is unavailable right now.");
  }
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) {
    try {
      const params = new URLSearchParams({
        app_id: env.ADZUNA_APP_ID,
        app_key: env.ADZUNA_APP_KEY,
        what: query,
        where: location,
        results_per_page: "30",
      });
      const country = /^[a-z]{2}$/.test(env.ADZUNA_COUNTRY || "")
        ? env.ADZUNA_COUNTRY
        : "in";
      const res = await fetch(
        "https://api.adzuna.com/v1/api/jobs/" + country + "/search/1?" + params,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      for (const j of data.results || [])
        jobs.push({
          id: "adzuna-" + j.id,
          title: j.title,
          company: j.company?.display_name || "Unspecified company",
          location: j.location?.display_name || "",
          description: plain(j.description),
          salary:
            j.salary_min && j.salary_max
              ? (country === "in" ? "INR " : country === "us" ? "USD " : "") +
                j.salary_min +
                " - " +
                j.salary_max +
                " per year"
              : "",
          url: j.redirect_url,
          remote: /remote/i.test(j.location?.display_name || ""),
          tags: [],
          source: "Adzuna",
          postedAt: j.created,
          sample: false,
        });
    } catch {
      errors.push("Adzuna is unavailable. Check its credentials in Settings.");
    }
  }
  return {
    jobs: jobs.filter((j) => /^https?:\/\//.test(j.url)),
    warnings: errors,
  };
}
export async function researchJob(job, env) {
  if (!env.TAVILY_API_KEY) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.TAVILY_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query:
        job.company +
        " " +
        job.title +
        " interview hiring process company products",
      max_results: 6,
      include_raw_content: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok)
    throw Object.assign(
      new Error(
        "Research provider unavailable. Check TAVILY_API_KEY or attach source excerpts manually.",
      ),
      { status: 502 },
    );
  const data = await res.json();
  return (data.results || []).map((r) => ({
    id: randomUUID(),
    url: r.url,
    title: r.title,
    content: r.content.slice(0, 5000),
  }));
}
