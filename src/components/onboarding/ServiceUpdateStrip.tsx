export function ServiceUpdateStrip({
  update
}: {
  update: {
    behaviorVersion: string;
    summary: string;
  };
}) {
  return (
    <section className="service-update-strip" aria-label="서비스 업데이트">
      <strong>서비스 업데이트</strong>
      <span>{update.summary}</span>
      <small>{update.behaviorVersion}</small>
    </section>
  );
}
