function genId() { return Math.random().toString(); }
const appData = {
  rooms: [
    {
      id: "room1",
      containers: [
        {
          id: "cont1",
          type: "cabinet",
          shelves: [
            { id: "s1", name: "Shelf A-A", chemicals: [] },
            { id: "s2", name: "Bottom", chemicals: [] }
          ]
        }
      ]
    }
  ]
};

const cont = appData.rooms[0].containers[0];
const shelf = cont.shelves[0]; // "Shelf A-A"
const v = { name: "auto" };
shelf.chemicals.push({id: genId(), position: "1", ...v});

console.log("Shelf A-A chemicals:", cont.shelves[0].chemicals.length);
console.log("Bottom chemicals:", cont.shelves[1].chemicals.length);
