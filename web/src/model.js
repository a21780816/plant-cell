import { Box3, Sphere } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function parseModel(bytes) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(ab, '', (gltf) => resolve(gltf.scene), reject));
}

export function findOrganelle(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData && o.userData.organelle !== undefined) return o.userData.organelle;
  }
  return null;
}

export function findInstanceRoot(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData && o.userData.inst !== undefined) return o;
  }
  return null;
}

export function indexModel(root) {
  root.updateMatrixWorld(true);
  const byId = new Map();
  let lid = null;
  const entry = (id) => {
    if (!byId.has(id)) byId.set(id, { meshes: [], instances: [], rep: null, anchor: null });
    return byId.get(id);
  };

  root.traverse((o) => {
    const u = o.userData;
    if (u.lid === 1 && !lid) lid = o;
    if (u.inst !== undefined && typeof u.organelle === 'string') {
      const e = entry(u.organelle);
      e.instances.push(o);
      if (u.rep === 1) {
        e.rep = o;
        let anchor = null;
        o.traverse((c) => { if (!anchor && c !== o && c.userData.anchor === 1) anchor = c; });
        e.anchor = anchor;
      }
    }
    if (o.isMesh) {
      const id = findOrganelle(o);
      if (id !== null) entry(id).meshes.push(o);
    }
  });
  for (const e of byId.values()) if (!e.anchor) e.anchor = e.rep;

  const sphere = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  return { byId, lid, center: sphere.center.clone(), radius: sphere.radius };
}
