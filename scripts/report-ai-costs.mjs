import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const result = await pool.query(`
    SELECT
      DATE_TRUNC('day', created_at)::date AS day,
      provider,
      model,
      billing_tier,
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE error_code IS NOT NULL)::int AS failures,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(thought_tokens), 0)::bigint AS thought_tokens,
      ROUND(AVG(latency_ms))::bigint AS average_latency_ms,
      COALESCE(SUM(estimated_list_cost_usd), 0)::numeric(14, 8) AS estimated_list_cost_usd,
      COALESCE(SUM(estimated_billed_cost_usd), 0)::numeric(14, 8) AS estimated_billed_cost_usd
    FROM ai_generation_usage
    GROUP BY 1, 2, 3, 4
    ORDER BY 1 DESC, 2, 3
  `);
  console.table(result.rows);
} finally {
  await pool.end();
}
