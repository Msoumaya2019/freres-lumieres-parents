export function SectionPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className="pill">PHASE 1 · APERÇU</span>
      </header>
      <section className="card placeholder">
        <div>
          <h2>Fondations prêtes</h2>
          <p>
            Cette page utilise uniquement des données fictives locales. La
            connexion à Firebase et les actions métier seront ajoutées dans leur
            phase dédiée.
          </p>
        </div>
      </section>
    </>
  );
}
