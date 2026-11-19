import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BodyReviewProgress } from "@/components/body-review-progress";

it("shows saved decisions and full-body coverage as different quantities", () => {
  const html = renderToStaticMarkup(
    <BodyReviewProgress
      progress={{
        review_id: "synthetic-review",
        total: 157,
        bodies_read: 100,
        fully_read: 20,
        decided: 90,
        dispositions: { delete: 80, retain: 2, uncertain: 8 },
      }}
    />,
  );
  expect(html).toContain("90 of 157 decisions saved");
  expect(html).toContain("100 emails opened for analysis");
  expect(html).toContain("20 complete bodies supplied");
  expect(html).toContain('value="90" max="157"');
  expect(html).toContain("do not apply mailbox changes");
});
