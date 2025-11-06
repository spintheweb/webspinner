// SPDX-License-Identifier: GPL-3.0-or-later
// Spin the Web component: stwRouter

// This file is responsible for handling /stw/action POST requests
import { STWSession } from "./stwSession.ts";

const actions = new Set(["adduser", "edituser", "deleteuser", "login", "logout", "addroles", "deleteroles", "addcontent", "editcontent", "deletecontent", "addlayout", "editlayout", "deletelayout"]);

