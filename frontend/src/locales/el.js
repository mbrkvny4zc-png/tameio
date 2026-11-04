import app from "./el-app";
import site from "./el-site";

// Greek dictionary: English source string -> Greek. Missing keys fall back to English.
export default { ...app, ...site };
