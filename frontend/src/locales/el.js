import app from "./el-app";
import site from "./el-site";
import added from "./el-new";
import round3 from "./el-round3";
import partners from "./el-partners";
import adminEl from "./el-admin";
import layoutEl from "./el-layout";
import reportsEl from "./el-reports";
import commentsEl from "./el-comments";

// Greek dictionary: English source string -> Greek. Missing keys fall back to English.
export default { ...app, ...site, ...added, ...round3, ...partners, ...adminEl, ...layoutEl, ...reportsEl, ...commentsEl };
