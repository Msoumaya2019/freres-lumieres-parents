const stats = [
  ['Demandes parents nouvelles', '7'],
  ['Membres FCPE en attente', '2'],
  ['Demandes en cours', '4'],
  ['Publications ce mois', '18'],
];
const actions = [
  ['Membre approuvé', 'Il y a 12 min'],
  ['Publication mise à jour', 'Il y a 1 h'],
  ['Demande transmise', 'Hier'],
];
const todo = [
  ['2 demandes membres', 'À valider'],
  ['3 conversations', 'À attribuer'],
  ['4 demandes parents', 'À suivre'],
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
