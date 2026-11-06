export const REPO = "https://github.com/matthieu-pm/carbonhq";

export const SITE = "https://carbon.forgenow.tech";

/// The server install. `public/install.sh` resolves the newest `cli-v*` tag
/// itself, so this line never needs a version in it.
export const INSTALL_LINE = "curl -fsSL https://carbon.forgenow.tech/install.sh | sh";

/// What the nav shows when GitHub cannot be asked. Bump it now and then so a
/// rate-limited render does not undercount by much.
export const STARS_FALLBACK = 58;
