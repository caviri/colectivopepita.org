// Shared mission todo list. Each page mounts it into its own
// `#todo-list` aside and supplies a getState() callback returning the
// live sample/culture counters (these aren't in IndexedDB until the
// player navigates, so we read them from page-local vars).

export const TODO_ITEMS = [
    { text: "Mine your first ice sample",   done: (s) => (s.samples ?? 0) > 0 || (s.cultures ?? 0) > 0 },
    { text: "Throw a sample with Q",        done: () => sessionStorage.getItem("todo-thrown") === "1" },
    { text: "Try first-person (V)",         done: () => sessionStorage.getItem("todo-usedFP") === "1" },
    { text: "Try orbit camera (Tab)",       done: () => sessionStorage.getItem("todo-usedOrbit") === "1" },
    { text: "Open the field manual",        done: () => sessionStorage.getItem("todo-readManual") === "1" },
    { text: "Enter the red lab",            done: () => sessionStorage.getItem("todo-visitedLab1") === "1" },
    { text: "Cultivate a sample",           done: (s) => (s.cultures ?? 0) > 0 },
    { text: "Visit the container lab",      done: () => sessionStorage.getItem("todo-visitedLab2") === "1" },
];

export function mountTodoList(container, getState) {
    if (!container) return () => {};
    const ul = container.querySelector("ul");
    if (!ul) return () => {};
    ul.innerHTML = "";
    const lis = TODO_ITEMS.map((item) => {
        const li = document.createElement("li");
        li.textContent = item.text;
        ul.appendChild(li);
        return li;
    });
    function update() {
        const s = (getState && getState()) || {};
        for (let i = 0; i < TODO_ITEMS.length; i++) {
            lis[i].classList.toggle("done", !!TODO_ITEMS[i].done(s));
        }
    }
    update();
    const interval = setInterval(update, 750);
    return () => clearInterval(interval);
}
