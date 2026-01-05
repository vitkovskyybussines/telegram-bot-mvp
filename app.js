const tg = window.Telegram.WebApp;
tg.expand();

let catalogEl = document.getElementById('catalog');
let order = {};

fetch('catalog.json')
  .then(res => res.json())
  .then(items => {
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'item';

      div.innerHTML = `
        <span>${item.name}</span>
        <input type="number" min="0" step="0.1" placeholder="кг"
          onchange="updateItem(${item.id}, '${item.name}', this.value)">
      `;

      catalogEl.appendChild(div);
    });
  });

function updateItem(id, name, value) {
  if (value && value > 0) {
    order[id] = { name, weight: value };
  } else {
    delete order[id];
  }
}

function submitOrder() {
  const comment = document.getElementById('comment').value;

  const items = Object.values(order);
  if (!items.length) {
    alert('Додайте хоча б один товар');
    return;
  }

  const data = {
    items,
    comment
  };

  tg.sendData(JSON.stringify(data));
  tg.close();
}
