export default function LoginPage() {
  return (
    <div className="login-page">
      <section className="login-card">
        <span className="pill">ESPACE SÉCURISÉ</span>
        <h1>Administration FCPE</h1>
        <p>Connectez-vous avec un compte autorisé.</p>
        <form>
          <div className="field">
            <label htmlFor="email">Adresse email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="admin@exemple.fr"
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <button className="primary-button" type="button">
            Se connecter
          </button>
        </form>
      </section>
    </div>
  );
}
