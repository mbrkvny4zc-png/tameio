import app from "./el-app";
import site from "./el-site";
import added from "./el-new";
import round3 from "./el-round3";
import partners from "./el-partners";
import adminEl from "./el-admin";

// Greek dictionary: English source string -> Greek. Missing keys fall back to English.
export default { ...app, ...site, ...added, ...round3, ...partners, ...adminEl };
