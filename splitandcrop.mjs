import sharp from "sharp";
import fs from "fs";
import nodepath from "path";

const IN_FOLDER = "./in";
const OUT_FOLDER = "./out";

const TOLERANCE_PERCENTAGE = 0.2;

async function getRegions(inputImg) {
  const { data, info } = await inputImg
    .clone()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tolerance = Math.floor(255 * TOLERANCE_PERCENTAGE);
  const isBg = (x) => x >= 255 - tolerance;

  let nextLabel = 1;
  const labels = new Uint32Array(info.width * info.height);

  const maxMargin = Math.ceil(Math.min(info.width, info.height) * 0.002);

  const getLabel = (x, y) => {
    for (let dist = 1; dist < maxMargin; dist++) {
      const x1 = Math.max(0, x - dist);
      const y1 = Math.max(0, y - dist);
      const vals = [
        labels[y * info.width + x1],
        labels[y1 * info.width + x],
        labels[y1 * info.width + x1],
      ];
      const nonZero = vals.filter((v) => v > 0);
      if (nonZero.length > 0) {
        return Math.min(...nonZero);
      }
      if (x1 === 0 && y1 === 0) break;
    }

    return nextLabel++;
  };

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = y * info.width + x;
      const px = data[offset];
      if (!isBg(px)) {
        labels[offset] = getLabel(x, y);
        // data[offset] = Math.floor(labels[offset] / 2);
      }
    }
  }

  const labelsToRegions = (() => {
    const regions = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const offset = y * info.width + x;
        const label = labels[offset];
        if (label === 0) continue;
        if (!regions[label]) {
          regions[label] = [x, y, x, y];
        } else {
          const [x1, y1, x2, y2] = regions[label];
          regions[label] = [
            Math.min(x1, x),
            Math.min(y1, y),
            Math.max(x2, x),
            Math.max(y2, y),
          ];
        }
      }
    }
    return regions;
  })();

  function enlarge([x1, y1, x2, y2]) {
    const diff = 5;
    return [
      Math.max(0, x1 - diff),
      Math.max(0, y1 - diff),
      Math.min(info.width - 1, x2 + diff),
      Math.min(info.height - 1, y2 + diff),
    ];
  }

  const intersects = ([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) => {
    return !(bx1 > ax2 || bx2 < ax1 || by1 > ay2 || by2 < ay1);
  };

  function merge([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
    return [
      Math.min(ax1, bx1),
      Math.min(ay1, by1),
      Math.max(ax2, bx2),
      Math.max(ay2, by2),
    ];
  }

  function mergeAll(regions) {
    while (true) {
      const res = regions.reduce((acc, curr) => {
        const intersection = acc.findIndex((a) =>
          intersects(enlarge(a), enlarge(curr))
        );
        if (intersection === -1) return [...acc, curr];
        const newArr = [...acc];
        newArr[intersection] = merge(newArr[intersection], curr);
        return newArr;
      }, []);
      if (res.length === regions.length) return res;

      regions = res;
    }
  }

  const regionsWithoutPoints = labelsToRegions
    .slice(1)
    // .filter(([ax1, ay1, ax2, ay2]) => ax2 - ax1 > 25 && ay2 - ay1 > 25);

  const finalRegions = mergeAll(regionsWithoutPoints).filter(
    ([ax1, ay1, ax2, ay2]) => ax2 - ax1 > 50 && ay2 - ay1 > 50
  );

  return finalRegions;
}

async function processImage(path) {
  const inputImg = await sharp(path);

  const finalRegions = await getRegions(inputImg);

  console.log(finalRegions);

  let i = 0;
  for (const region of finalRegions) {
    await inputImg
      .clone()
      .extract({
        left: region[0],
        top: region[1],
        width: region[2] - region[0],
        height: region[3] - region[1],
      })
      .jpeg({
        quality: 85,
      })
      .toFile(`${OUT_FOLDER}/${nodepath.parse(path).name}_${i++}.jpg`);
  }
}

(async () => {
  const files = fs.readdirSync(IN_FOLDER);

  for (const file of files) {
    console.log(file);
    await processImage(`${IN_FOLDER}/${file}`);
  }
})();
