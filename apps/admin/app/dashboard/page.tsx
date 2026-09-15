const stats = [
  ['Parents inscrits', '342'],
  ['Comptes en attente', '12'],
  ['Signalements ouverts', '7'],
  ['Publications ce mois', '18'],
];
const actions = [
  ['Compte approuvé', 'Il y a 12 min'],
  ['Publication mise à jour', 'Il y a 1 h'],
  ['Signalement transmis', 'Hier'],
];
const todo = [
  ['12 inscriptions', 'À valider'],
  ['3 contenus signalés', 'À modérer'],
  ['7 signalements', 'À suivre'],
];

export default function DashboardPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Tableau de bord</h1>
          <p>Vue d’ensemble de la communauté scolaire.</p>
        </div>
        <span className="pill">DONNÉES FICTIVES</span>
      </header>
      <section className="grid">
        {stats.map(([label, value]) => (
          <article className="card" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </article>
        ))}
      </section>
      <section className="two-columns">
        <article className="card">
          <h2>Dernières actions</h2>
          <div className="list">
            {actions.map(([label, time]) => (
              <div className="list-row" key={label}>
                <span>{label}</span>
                <small>{time}</small>
              </div>
            ))}
          </div>
        </article>
        <article className="card">
          <h2>À traiter</h2>
          <div className="list">
            {todo.map(([label, state]) => (
              <div className="list-row" key={label}>
                <span>{label}</span>
                <small>{state}</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}
