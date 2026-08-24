// 浏览器DOM桩(Node自检用)
const fakeEl = () => ({ addEventListener(){}, style:{}, textContent:'', innerHTML:'' });
global.document = { querySelector: () => fakeEl() };
global.window = global;
