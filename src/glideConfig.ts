import { createGlideConfig } from "@paywithglide/glide-js";
import { base, polygon } from "@paywithglide/glide-js/chains";

export const glideConfig = createGlideConfig({
  projectId: import.meta.env.VITE_GLIDE_PROJECT_ID,
  chains: [base, polygon],
});
