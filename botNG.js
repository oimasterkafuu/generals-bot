const {Builder, By, Key, until} = require('selenium-webdriver');
const readline = require('readline');
const config = require('./config.json');

const TYPE = {
  FOG: 0,       // neutral cells in fog
  OBSTACLE: 1,  // unknown mountain, city cells
  MOUNTAIN: 2,  // mountain cell
  GENERAL: 3,   // general cell
  CITY: 4,      // city cell
  NEUTRAL: 5    // neutral cell (empty cell)
};

const DIRECTION = {
  UP: {key: Key.ARROW_UP, dx: -1, dy: 0},
  DOWN: {key: Key.ARROW_DOWN, dx: 1, dy: 0},
  LEFT: {key: Key.ARROW_LEFT, dx: 0, dy: -1},
  RIGHT: {key: Key.ARROW_RIGHT, dx: 0, dy: 1}
};

const COLORS = [
  'red', 'green', 'lightblue', 'purple', 'teal', 'orange', 'maroon', 'yellow',
  'pink', 'brown', 'lightgreen', 'purpleblue'
];  // colors for players

(async () => {
  const driver = await new Builder().forBrowser('chrome').build();

  class Cell {
    constructor(type, army, isMine, isEnemy) {
      this.type = type;
      this.army = army;
      this.isMine = isMine;
      this.isEnemy = isEnemy;
      this.priority = 0;
    }
    update(type, army, isMine, isEnemy) {
      // for type
      // FOG / OBSTACLE -> NEUTRAL / MOUNTAIN / CITY / GENERAL is OK
      // NEUTRAL / MOUNTAIN / CITY -> FOG / OBSTACLE is NOT OK
      // GENERAL -> CITY(OBSTACLE) is OK (the general was captured)
      if (type !== TYPE.FOG && type !== TYPE.OBSTACLE) {
        this.type = type;
      } else if (
          this.type === TYPE.GENERAL &&
          (type === TYPE.CITY || type === TYPE.OBSTACLE)) {
        this.type = TYPE.CITY;
      } else if (this.type === TYPE.FOG && type === TYPE.OBSTACLE) {
        this.type = TYPE.OBSTACLE;
      }

      // for army
      // FOG / OBSTACLE is not OK
      if (type !== TYPE.FOG && type !== TYPE.OBSTACLE) {
        this.army = army;
      }
      if (this.type === TYPE.OBSTACLE || this.type === TYPE.MOUNTAIN) {
        this.army = Infinity;
      }

      // for isMine
      this.isMine = isMine;

      // for isEnemy
      // FOG / OBSTACLE / MOUNTAIN is NOT OK
      // isMine is true -> true is NOT OK
      if (type !== TYPE.FOG && type !== TYPE.OBSTACLE &&
          this.type !== TYPE.MOUNTAIN && !isMine) {
        this.isEnemy = isEnemy;
      }
    }
    addPriority(v) {
      this.priority += v;
    }
  }
  class Map {
    constructor() {
      this.map = [];
      this.sizeN = 0;
      this.sizeM = 0;

      this.myGeneral = null;
      this.myColor = null;

      this.lastMove = null;
      this.cursor = null;
      this.turn = 0;
    }
    async init() {
      // get map size
      var table = await driver.findElement(By.css('table#gameMap'));
      var innerHTML = await table.getAttribute('innerHTML');
      // use regex to parse the map, because it is faster
      var map = innerHTML.match(/<tr>[\s\S]*?<\/tr>/g);
      this.sizeN = map.length;
      this.sizeM = map[0].match(/<td[\s\S]*?<\/td>/g).length;

      // get my color
      this.myColor = await driver.findElement(By.css('td.general.selectable'))
                         .getAttribute('class')
                         .then((className) => {
                           for (var color of COLORS) {
                             if (className.includes(color)) {
                               return color;
                             }
                           }
                         });

      this.map = [];
      for (var i = 0; i < this.sizeN; ++i) {
        this.map.push([]);
        for (var j = 0; j < this.sizeM; ++j) {
          this.map[i].push(new Cell(TYPE.FOG, 0, false, false));
        }
      }
    }
    async update(turn) {
      this.turn = turn;
      this.myGeneral = null;

      var table = await driver.findElement(By.css('table#gameMap'));
      var innerHTML = await table.getAttribute('innerHTML');
      // use regex to parse the map, because it is faster
      var map = innerHTML.match(/<tr>[\s\S]*?<\/tr>/g);
      for (var i = 0; i < this.sizeN; ++i) {
        var rowMap = map[i].match(/<td[\s\S]*?<\/td>/g);
        for (var j = 0; j < this.sizeM; ++j) {
          var cell = rowMap[j];
          var cellClass = cell.match(/class="[\s\S]*?"/g)[0];
          var cellArmy = cell.match(/>[\s\S]*?</g)[0].slice(1, -1);
          var army = parseInt(cellArmy);
          if (isNaN(army)) army = 0;
          var isMine = cellClass.includes(this.myColor);
          var isEnemy = false;
          for (var color of COLORS) {
            if (cellClass.includes(color) && color !== this.myColor) {
              isEnemy = true;
              break;
            }
          }
          var type = TYPE.NEUTRAL;
          if (cellClass.includes('fog')) {
            if (cellClass.includes('obstacle')) {
              type = TYPE.OBSTACLE;
            } else {
              type = TYPE.FOG;
            }
          } else if (cellClass.includes('mountain')) {
            type = TYPE.MOUNTAIN;
          } else if (cellClass.includes('city')) {
            type = TYPE.CITY;
          } else if (cellClass.includes('general')) {
            type = TYPE.GENERAL;
          }
          if (isMine) army = -army;

          this.map[i][j].update(type, army, isMine, isEnemy);

          if (this.map[i][j].type === TYPE.GENERAL && isMine) {
            this.myGeneral = {x: i, y: j};
          }
          if ((type === TYPE.CITY || type === TYPE.GENERAL) &&
              (this.map[i][j].isMine || this.map[i][j].isEnemy)) {
            if (this.map[i][j].isMine)
              --this.map[i][j].army;
            else
              ++this.map[i][j].army;
          }
        }
      }

      // move the last move in the map
      if (this.lastMove !== null) {
        var {x: fromX, y: fromY} = this.lastMove.from;
        var {x: toX, y: toY} = this.lastMove.to;
        var half = this.lastMove.half;

        var fromCell = this.map[fromX][fromY];
        var toCell = this.map[toX][toY];

        if (fromCell.isMine) {
          var moveArmy = fromCell.army + 1;
          if (half) {
            moveArmy = Math.ceil(moveArmy / 2);
          }
          fromCell.army -= moveArmy;
          toCell.army += moveArmy;
          if (toCell.army <= -1) {
            toCell.isMine = true;
          }
        }

        this.lastMove = null;
      }

      // calculate priority
      // find all the cells that can see enemy
      var cellsCanSeeEnemy = this.findAll((e) => {
        if (!this.map[e.x][e.y].isMine) return false;
        // for (var dx = -1; dx <= 1; ++dx) {
        //   for (var dy = -1; dy <= 1; ++dy) {
        //     if (dx === 0 && dy === 0) continue;
        //     var x = e.x + dx;
        //     var y = e.y + dy;
        //     if (x < 0 || x >= this.sizeN || y < 0 || y >= this.sizeM)
        //     continue; if (this.map[x][y].isEnemy) return true;
        //   }
        // }
        return true;
      });
      // add the priority
      for (var cell of cellsCanSeeEnemy) {
        for (var dx = -1; dx <= 1; ++dx) {
          for (var dy = -1; dy <= 1; ++dy) {
            if (dx === 0 && dy === 0) continue;
            var x = cell.x + dx;
            var y = cell.y + dy;
            if (x < 0 || x >= this.sizeN || y < 0 || y >= this.sizeM) continue;
            var val;
            if (this.map[x][y].isEnemy) {
              val = 1024;
            } else {
              val = -128;
            }
            while (val && x >= 0 && x < this.sizeN && y >= 0 &&
                   y < this.sizeM) {
              this.map[x][y].addPriority(val);
              val = Math.floor(val / 2);
              x += dx;
              y += dy;
            }
          }
        }
      }
    }
    printMap() {
      // used to debug, render the map in the console
      function fixedWidth(num, width) {
        num = Math.abs(num);
        var str = num.toString();
        if (num == Infinity || str.length > width)
          str = '-'.repeat(Math.min(2, width));
        str = str + ' '.repeat(width - str.length);
        return str;
      }
      var map = '';
      var color2terminal = {
        RESET: '\x1b[0m',
        MINE: '\x1b[34m',
        ENEMY: '\x1b[31m',
        WARN: '\x1b[33m',
        NOWARN: '\x1b[36m',
        CURSOR: '\x1b[32m',
        FREE: '\x1b[35m',
        GENERAL: '\x1b[30m',
      };
      for (var i = 0; i < this.sizeN; ++i) {
        for (var j = 0; j < this.sizeM; ++j) {
          var cell = this.map[i][j];
          var color = color2terminal.RESET;
          if (cell.isMine) {
            color = color2terminal.MINE;
          } else if (cell.isEnemy) {
            color = color2terminal.ENEMY;
          } else if (
              cell.type === TYPE.MOUNTAIN || cell.type === TYPE.OBSTACLE ||
              cell.type === TYPE.CITY) {
            color = color2terminal.FREE;
          } else if (cell.priority && cell.type === TYPE.FOG) {
            if (cell.priority > 0)
              color = color2terminal.WARN;
            else
              color = color2terminal.NOWARN;
          }
          if (this.cursor && this.cursor.x === i && this.cursor.y === j) {
            color = color2terminal.CURSOR;
          }
          if (cell.type === TYPE.GENERAL) color = color2terminal.GENERAL;
          map += color + fixedWidth(cell.army, 4) + color2terminal.RESET;
        }
        map += '\n';
      }
      // console.log(map);
      // use readline to flush the map
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
      process.stdout.write(map);
    }
    async move(from, to, half = false) {
      var {x: fromX, y: fromY} = from;
      var {x: toX, y: toY} = to;

      // check army
      if (this.map[fromX][fromY].army + this.map[toX][toY].army >= -1) {
        // block the move
        console.error('block the move', from, to, half);
        return false;
      }

      // console.log('move', from, to, half);

      if (!this.cursor || this.cursor.x !== fromX || this.cursor.y !== fromY) {
        // press space and click on the cell
        await driver.actions().sendKeys(Key.SPACE).perform();

        var table = await driver.findElement(By.css('table#gameMap'));
        var rows = await table.findElements(By.css('tr'));
        var row = rows[fromX];
        var cells = await row.findElements(By.css('td'));
        var cell = cells[fromY];
        await cell.click();
      }

      if (half) {
        await driver.actions().sendKeys('z').perform();
        throw new Error('Not implemented');
      }

      var key = null;
      for (var k of Object.keys(DIRECTION)) {
        if (DIRECTION[k].dx === toX - fromX &&
            DIRECTION[k].dy === toY - fromY) {
          key = DIRECTION[k].key;
          // console.log('key', k);
          break;
        }
      }

      if (key !== null) {
        await driver.actions().sendKeys(key).perform();
      } else {
        throw new Error('Invalid move');
      }

      this.cursor = to;
      this.lastMove = {from, to, half};

      return true;
    }
    async sendMessage(msg) {
      await driver.actions().sendKeys(Key.SPACE).perform();
      this.cursor = null;  // the map lost the focus
      await driver.actions().sendKeys(Key.ENTER).perform();
      await driver.actions().sendKeys(msg).perform();
      await driver.actions().sendKeys(Key.ENTER).perform();
    }
    findAll(where, shuffle = false) {
      var results = [];
      for (var i = 0; i < this.sizeN; ++i) {
        for (var j = 0; j < this.sizeM; ++j) {
          if (where({x: i, y: j})) {
            results.push({x: i, y: j});
          }
        }
      }
      if (shuffle) {
        for (var i = 0; i < results.length; ++i) {
          var j = Math.floor(Math.random() * results.length);
          var tmp = results[i];
          results[i] = results[j];
          results[j] = tmp;
        }
      }
      return results;
    }
    find(where, random = false) {
      var results = this.findAll(where, random);
      if (results.length === 0) return null;
      if (!random) return results[0];
      return results[Math.floor(Math.random() * results.length)];
    }
    heuristic(from, to, explore = false) {
      if (this.map[to.x][to.y].type === TYPE.OBSTACLE ||
          this.map[to.x][to.y].type === TYPE.MOUNTAIN)
        return Infinity;
      var manhattan = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
      var army = this.map[from.x][from.y].army;
      if (explore && army < 0) army += 2;
      if (explore && this.map[from.x][from.y].type === TYPE.FOG) army -= 2;
      return manhattan + army / 8;
    }
    findPath(from, to, explore = false) {
      // use A* to find the path from `from` to `to`
      // need not to be the shortest, but should have enough army
      var open = [];
      var closed = [];
      var cameFrom = [];
      var gScore = [];
      var fScore = [];
      for (var i = 0; i < this.sizeN; ++i) {
        cameFrom.push([]);
        gScore.push([]);
        fScore.push([]);
        for (var j = 0; j < this.sizeM; ++j) {
          cameFrom[i].push(null);
          gScore[i].push(Infinity);
          fScore[i].push(Infinity);
        }
      }
      // Initialize the open and closed lists
      gScore[from.x][from.y] = 0;
      fScore[from.x][from.y] = this.heuristic(from, to, explore);
      open.push(from);

      // Loop until we find the destination
      while (open.length > 0) {
        // Find the node in the open list with the lowest fScore
        var currentX, currentY, currentF = Infinity, currentInd = -1;
        for (var i = 0; i < open.length; ++i) {
          var f = fScore[open[i].x][open[i].y];
          if (f < currentF) {
            currentX = open[i].x;
            currentY = open[i].y;
            currentF = f;
            currentInd = i;
          }
        }
        // console.log(`currentX: ${currentX}, currentY: ${currentY}`);
        if (currentX === to.x && currentY === to.y) {
          // Reconstruct and return the path
          var path = [];
          var current = to;
          while (current.x !== from.x || current.y !== from.y) {
            path.push(current);
            current = cameFrom[current.x][current.y];
          }
          return path.reverse();
        }
        // Remove the current node from the open list and add it to the closed
        // list
        open.splice(currentInd, 1);
        closed.push({x: currentX, y: currentY});
        for (var i of Object.keys(DIRECTION)) {
          var newX = currentX + DIRECTION[i].dx;
          var newY = currentY + DIRECTION[i].dy;
          if (newX < 0 || newX >= this.sizeN || newY < 0 || newY >= this.sizeM)
            continue;
          if (this.map[newX][newY].type === TYPE.MOUNTAIN ||
              this.map[newX][newY].type === TYPE.OBSTACLE)
            continue;
          if (closed.some((e) => e.x === newX && e.y === newY)) continue;
          // Compute the gScore, fScore and add this node to the open list
          var tentativeGScore = gScore[currentX][currentY] +
              this.heuristic(
                  {x: currentX, y: currentY}, {x: newX, y: newY}, explore);
          1;
          if (!open.some((e) => e.x === newX && e.y === newY))
            open.push({x: newX, y: newY});
          else if (tentativeGScore >= gScore[newX][newY])
            continue;
          cameFrom[newX][newY] = {x: currentX, y: currentY};
          gScore[newX][newY] = tentativeGScore;
          fScore[newX][newY] = gScore[newX][newY] +
              this.heuristic({x: newX, y: newY}, to, explore);
        }
      }
      return [];
    }
    distance(from, to) {
      if (from.x === to.x && from.y === to.y) return 0;
      var path = this.findPath(from, to);
      if (path.length === 0) return Infinity;
      return path.length;
    }
  };

  class SmartBot {
    async botMove(map) {
      if (map.turn == 1) await map.sendMessage('glhf');

      if (turn < 30) {
        return false;
      }

      // if we've found a enemy general, attack it
      if (map.turn >= 50) {
        // console.log('attack general')
        var general = map.find(
            (e) => map.map[e.x][e.y].type === TYPE.GENERAL &&
                !map.map[e.x][e.y].isMine);

        var dangerous = null;
        var dangerDistance = Infinity;
        for (var dx = -2; dx <= 2; ++dx) {
          for (var dy = -2; dy <= 2; ++dy) {
            if (dx === 0 && dy === 0) continue;
            var x = map.myGeneral.x + dx;
            var y = map.myGeneral.y + dy;
            if (x < 0 || x >= map.sizeN || y < 0 || y >= map.sizeM) continue;
            if (map.map[x][y].isEnemy) {
              var distance = map.distance(map.myGeneral, {x, y});
              if (distance < dangerDistance) {
                dangerous = {x, y};
                dangerDistance = distance;
              }
            }
          }
        }

        if (!general && dangerous) {
          general = dangerous;
        }

        if (general && (await this.attack(map, general))) {
          // console.log('attack general');
          return true;
        }
      }

      // console.log('pre tao');
      if (await this.preTao(map)) return true;

      // find a non-mine city has the least army
      if (map.turn >= 300) {
        // console.log('attack city');
        var cities = map.findAll(
            (e) => map.map[e.x][e.y].type === TYPE.CITY &&
                !map.map[e.x][e.y].isMine);
        // for every city, if it neighbors has a enemy, double it's army
        for (var city of cities) {
          for (var dx = -1; dx <= 1; ++dx) {
            for (var dy = -1; dy <= 1; ++dy) {
              if (dx === 0 && dy === 0) continue;
              var x = city.x + dx;
              var y = city.y + dy;
              if (x < 0 || x >= map.sizeN || y < 0 || y >= map.sizeM) continue;
              if (map.map[x][y].isEnemy) {
                map.map[city.x][city.y].army = Infinity;
                break;
              }
            }
          }
        }

        cities.sort((a, b) => map.map[a.x][a.y].army - map.map[b.x][b.y].army);
        while (cities.length > 0) {
          var city = cities.shift();
          if (await this.attack(map, city, true)) {
            // console.log('attack city');
            return true;
          }
        }
      }

      // console.log('tao');
      if (await this.tao(map)) return true;

      // console.log('expand');
      return (await this.expand(map));
    }
    async attack(map, target, single = false) {
      var myCells = map.findAll(
          (e) => map.map[e.x][e.y].isMine && map.map[e.x][e.y].army < -1);
      myCells.sort((a, b) => map.map[a.x][a.y].army - map.map[b.x][b.y].army);

      var needed = 0;
      var existArmy = 0;
      while (needed < myCells.length &&
             existArmy + map.map[target.x][target.y].army >= -1) {
        existArmy += map.map[myCells[needed].x][myCells[needed].y].army + 1;
        ++needed;
      }
      if (existArmy + map.map[target.x][target.y].army >= -1) return false;
      myCells = myCells.slice(0, needed);
      myCells.sort((a, b) => {
        // if (map.map[a.x][a.y].type === map.map[b.x][b.y].type) {
        //   map.distance(a, target) - map.distance(b, target)
        // } else {
        //   // neutral > city > general
        //   return map.map[a.x][a.y].type - map.map[b.x][b.y].type;
        // }
        return map.distance(a, target) - map.distance(b, target);
      });
      // console.log('myCells', myCells);
      if (myCells.length > 1) {
        if (single) {
          return false;
        }
        // console.log(
        //     'find path from', myCells[myCells.length - 1], 'to',
        //     myCells[myCells.length - 2]);
        var path = map.findPath(
            myCells[myCells.length - 1], myCells[myCells.length - 2]);
        if (path.length === 0) return false;
        return (await map.move(myCells[myCells.length - 1], path[0]));
      } else {
        // find the nearest cell which can attack the target
        var cells = map.findAll(
            (e) => map.map[e.x][e.y].isMine &&
                map.map[e.x][e.y].army + map.map[target.x][target.y].army < -1);
        cells.sort((a, b) => map.distance(a, target) - map.distance(b, target));
        if (cells.length === 0) return false;
        // console.log('the nearest cell is', cells[0]);
        var path = map.findPath(cells[0], target);
        // console.log('path', path);
        if (path.length === 0) return false;
        return (await map.move(cells[0], path[0]));
      }
    }
    async expand(map) {
      var borders = map.findAll((e) => {
        var {x, y} = e;
        if (!map.map[x][y].isMine) return false;
        // check for all 4 directions, if there is a cell that is not mine and
        // not a mountain/obstacle/city
        var neighbor = false;
        for (var i of Object.keys(DIRECTION)) {
          var newX = x + DIRECTION[i].dx;
          var newY = y + DIRECTION[i].dy;
          if (newX < 0 || newX >= map.sizeN || newY < 0 || newY >= map.sizeM)
            continue;
          if (map.map[newX][newY].type === TYPE.MOUNTAIN ||
              map.map[newX][newY].type === TYPE.OBSTACLE ||
              map.map[newX][newY].isMine ||
              map.map[newX][newY].army + map.map[x][y].army >= -1)
            continue;
          neighbor = true;
          break;
        }
        return neighbor;
      });
      // console.log(borders);
      if (borders.length !== 0) {
        borders.sort((a, b) => map.map[a.x][a.y].army - map.map[b.x][b.y].army);
        var from = borders[0];
        var to = null;
        for (var i of Object.keys(DIRECTION)) {
          var newX = from.x + DIRECTION[i].dx;
          var newY = from.y + DIRECTION[i].dy;
          if (newX < 0 || newX >= map.sizeN || newY < 0 || newY >= map.sizeM)
            continue;
          if (map.map[newX][newY].type === TYPE.MOUNTAIN ||
              map.map[newX][newY].type === TYPE.OBSTACLE ||
              map.map[newX][newY].isMine ||
              map.map[newX][newY].army + map.map[from.x][from.y].army >= -1)
            continue;
          to = {x: newX, y: newY};
        }
        // console.log('expand', from, to);
        if (to && (await map.move(from, to))) {
          return true;
        }
      }

      // move the biggest cell to the nearest border
      var myCells = map.findAll(
          (e) => map.map[e.x][e.y].isMine && map.map[e.x][e.y].army < -1);
      myCells.sort((a, b) => map.map[a.x][a.y].army - map.map[b.x][b.y].army);
      if (myCells.length === 0) return false;
      var biggest = myCells[0];
      borders = map.findAll((e) => {
        var {x, y} = e;
        if (!map.map[x][y].isMine) return false;
        // check for all 4 directions, if there is a cell that is not mine and
        // not a mountain/obstacle/city
        var neighbor = false;
        for (var i of Object.keys(DIRECTION)) {
          var newX = x + DIRECTION[i].dx;
          var newY = y + DIRECTION[i].dy;
          if (newX < 0 || newX >= map.sizeN || newY < 0 || newY >= map.sizeM)
            continue;
          if (map.map[newX][newY].type === TYPE.MOUNTAIN ||
              map.map[newX][newY].type === TYPE.OBSTACLE ||
              map.map[newX][newY].type === TYPE.CITY ||
              map.map[newX][newY].isMine)
            continue;
          neighbor = true;
          break;
        }
        return neighbor;
      });
      borders.sort(
          (a, b) => map.distance(a, biggest) - map.distance(b, biggest));
      var path = map.findPath(biggest, borders[0]);
      if (path.length === 0) return false;
      return (await map.move(biggest, path[0]));
    }
    async preTao(map) {
      // console.log('taoPath', this.taoPath);
      if (this.taoPath && this.taoPath.length > 1) {
        // check if the path is still available
        var {x: fromX, y: fromY} = this.taoPath[0];
        var {x: toX, y: toY} = this.taoPath[1];
        if (map.map[fromX][fromY].army < -1 &&
            map.map[fromX][fromY].army + map.map[toX][toY].army < -1) {
          // move to the next cell
          this.taoPath.shift();
          return (await map.move({x: fromX, y: fromY}, this.taoPath[0]));
        }
      }
      return false;
    }
    async tao(map) {
      // in Chinese, 掏 means to dig, to excavate
      // find my army biggest cell
      var from = null;
      if (map.cursor && map.map[map.cursor.x][map.cursor.y].isMine &&
          map.map[map.cursor.x][map.cursor.y].army < -1) {
        for (var i of Object.keys(DIRECTION)) {
          var newX = map.cursor.x + DIRECTION[i].dx;
          var newY = map.cursor.y + DIRECTION[i].dy;
          if (newX < 0 || newX >= map.sizeN || newY < 0 || newY >= map.sizeM)
            continue;
          if (map.map[newX][newY].type === TYPE.MOUNTAIN ||
              map.map[newX][newY].type === TYPE.OBSTACLE ||
              map.map[newX][newY].army +
                      map.map[map.cursor.x][map.cursor.y].army >=
                  -1)
            continue;
          from = map.cursor;
          break;
        }
      }
      if (!from) {
        var myCells = map.findAll((e) => map.map[e.x][e.y].isMine);
        myCells.sort((a, b) => map.map[a.x][a.y].army - map.map[b.x][b.y].army);
        from = myCells[0];
        if (map.map[from.x][from.y].army >= -10) return false;
      }
      // select a random target that is not mine and not a
      // mountain/obstacle/city
      var targets = map.findAll((e) => {
        var {x, y} = e;
        return map.map[x][y].type === TYPE.FOG;
      });
      if (!targets) return false;
      // sort by distance
      targets.sort(
          (a, b) =>
              (map.distance(b, from) + map.map[b.x][b.y].priority * 1000) -
              (map.distance(a, from) + map.map[a.x][a.y].priority * 1000));
      // shuffle the first half targets(if exists)
      // var halfIndex = Math.floor(targets.length / 10);
      // for (var i = 0; i < halfIndex; ++i) {
      //   var j = Math.floor(Math.random() * (halfIndex - i)) + i;
      //   var temp = targets[i];
      //   targets[i] = targets[j];
      //   targets[j] = temp;
      // }
      // console.log(targets);
      var targetIndex = 0;
      do {
        this.taoPath = map.findPath(from, targets[targetIndex], true);
        ++targetIndex;
      } while (this.taoPath.length == 0 && targetIndex < targets.length);
      if (this.taoPath.length == 0) return false;
      // console.log('tao', from, this.taoPath);
      return (await map.move(from, this.taoPath[0]));
    }
  }

  try {
    await driver.get('http://bot.generals.io/games/' + config.room_id);
    await driver.sleep(1000);

    await driver.executeScript(
        'localStorage.setItem("user_id", "' + config.user_id + '");' +
        'localStorage.setItem("gio_ffa_rules", "true");' +
        'localStorage.setItem("completed_tutorial", "true");');

    await driver.sleep(1000);
    await driver.navigate().refresh();

    await driver.wait(
        until.elementLocated(By.css('button[style="display: block;"]')));
    
    var clickerInterval = setInterval(async function() {
      try{
        await driver.findElement(By.css('button[style="display: block;"]')).click();
      } catch (e) {
        // console.log(e);
      }
    }, 2000);

    await driver.wait(until.elementLocated(By.css('div#turn-counter')));
    // console.log('game started');
    clearInterval(clickerInterval);

    for (var i = 0; i < 3; ++i) {
      await driver.actions().sendKeys('9').perform();
    }

    var map = new Map();
    await map.init();
    var turn = 0;

    var bot = new SmartBot();

    var gameInterval = setInterval(async function() {
      try {
        ++turn;
        await map.update(turn);
        // console.log('turn', turn);
        map.printMap();
        await bot.botMove(map);
      } catch (e) {
        // console.log(e);
      }
    }, 500);

    await driver.wait(until.elementLocated(By.css('span.game-end-alert')));
    // console.log('game ended');
    clearInterval(gameInterval);
    map.sendMessage('ggwp');
  } catch (e) {
    // console.log(e);
  } finally {
    await driver.quit();
  }
})();