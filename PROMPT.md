I'd like to create a desktop app which will display a git repository in a nice graphical way. 
Check current folder - there is source-tree.png screenshot for inspiration of Source Tree app.

Proposed layout (I'm opened to suggestions):
- Left panel: All branches (in origin, local sections) panel, tags, work trees.
- Top toolbar: action buttons - Commit, Pull, Push, Branch, Merge, Stash (icons, text, tooltips)
- Central panel: displays the branch "railway" with possibility to filter it by branch, author, search commit message. Take care to make branches distinguishable.
  - Once a commit/uncommited changes are selected - central panel also displays affected files, and if file is selected you can see nicely visualized diff
  - Working changes are highlighted on top. User can select files for staging, then select commit message and commit.
  - Note that there can be commit, push hooks running various tools in terminal. User needs to see output, progress.

Notes:
- When app is launched, there will be list of added repositories - with ability to add other locally checked out repos, make the list searchable (search is focused item on launch, Enter key opens first item in the list, ESC cancel search and keeps it focused)
- Added repos can be removed (no changes on disk, just saved repo removal)
- Use system git (we can check if it's correctly configured)
- Take care to display useful information in non-overhelming way
- Make UI intiutive, modern and clean
- Support dark/light theme (got from system or manually switched)
- Common actions should have keyboard shortcuts (which shouldn't be easily pressed by accident)
- App will be executed all the time, take care so it don't drain system resources and have (if possible near to zero idle requirements)
- Take care to design clear UI of reposity overview - straight branches if possible, distinguished (e.g.) by different colors, came up with easy navigation with one branch and multiple branches

Tech stack:
- I'd like to implementation in rust, https://gpui.rs/ gui library
- It should support MacOS, Windows, Linux

Questions:
- Is Rust & GPUI good choce? Or would it be better, e.g., Tauri 2 & Typescript?