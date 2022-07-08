// to patch the theme
// Replaces the `theia-preload` selector with `old-theia-preload` in the generated `index.html`.
let arg = process.argv.splice(2)[0]
if (!arg) {
    console.error("The path to the index.html to patch is missing. Use 'node patch-theia-preload.js ./path/to/index.html'")
    process.exit(1)
}
(async () => {
    const snippet = `

`
    const { promises: fs } = require('fs')
    const path = require('path')
    const index = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg)
    console.log(`>>> Patching 'theia-preload' with 'old-theia-preload' in ${index}.`)
    const content = await fs.readFile(index, { encoding: 'utf-8' })
    await fs.writeFile(index, content.replace(/ThemeService.get().loadUserTheme();/g, 'your own else if based on OS theme'), { encoding: 'utf-8' })
    console.log(`<<< Successfully patched index.html.`)
})()