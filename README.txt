Valu-Present Live Display - viewer page
=======================================

These files are the web page that judges, counsel and witnesses open to watch a shared Display.
The page holds no case data. It only shows what the presenter's Valu-Present sends it, encrypted.

Put them on any web server
--------------------------
1. Copy index.html, viewer.js and proto.js into one folder on your web server,
   for example  https://www.yourfirm.com/watch/
2. The address MUST start with https:// (browsers only allow the encrypted connection on https pages).
3. Nothing to install on the server - these are plain files (no PHP, no database).
4. In Valu-Present: App Settings -> Presenting -> Sharing the Display -> Viewer page,
   type your address (for example https://www.yourfirm.com/watch/).

Or GitHub Pages (free)
----------------------
1. github.com -> + -> New repository -> name it  watch  -> Public -> Create.
2. "uploading an existing file" -> drag in the three files -> Commit changes.
3. Settings -> Pages -> Branch: main, /(root) -> Save.
4. After a minute: https://YOUR-GITHUB-NAME.github.io/watch/  -> put that in the setting above.

When Valu-Present updates the viewer page, save the files again from the same setting and replace the old ones.
