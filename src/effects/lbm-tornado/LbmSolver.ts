import { defaults, type TornadoParameters } from './config.ts';

// D3Q19 lattice. Opposite directions occur in adjacent pairs after rest.
export const CX = new Int8Array([0, 1,-1, 0, 0, 0, 0, 1,-1, 1,-1, 1,-1, 1,-1, 0, 0, 0, 0]);
export const CY = new Int8Array([0, 0, 0, 1,-1, 0, 0, 1,-1,-1, 1, 0, 0, 0, 0, 1,-1, 1,-1]);
export const CZ = new Int8Array([0, 0, 0, 0, 0, 1,-1, 0, 0, 0, 0, 1,-1,-1, 1, 1,-1,-1, 1]);
export const W = new Float64Array([1/3, ...Array(6).fill(1/18), ...Array(12).fill(1/36)]);
const opposite = (q: number) => q === 0 ? 0 : (q % 2 ? q + 1 : q - 1);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Forced BGK LBM in lattice units, with Guo forcing and pull streaming.
 * Smoke is a passive scalar, semi-Lagrangian advected by the solved velocity.
 * Analytic vortex forcing/condensation art-direct the funnel; this is a visual
 * fluid simulation, not a meteorological model or a reconstruction of UE code.
 */
export class LbmSolver {
  readonly size: number;
  private f: Float32Array;
  private next: Float32Array;
  readonly velocity: Float32Array;
  density: Float32Array;
  private nextDensity: Float32Array;
  private target: Float32Array;
  private condensation: Float32Array;
  private populations = new Float64Array(19);
  parameters: TornadoParameters;
  iteration = 0;
  maxSpeed = 0;

  constructor(readonly nx: number, readonly ny: number, readonly nz: number, parameters = defaults) {
    if (![nx, ny, nz].every(n => Number.isInteger(n) && n >= 6)) throw new Error('LBM grid dimensions must be integers >= 6');
    this.parameters = { ...parameters };
    this.size = nx * ny * nz;
    this.f = new Float32Array(this.size * 19);
    this.next = new Float32Array(this.size * 19);
    this.velocity = new Float32Array(this.size * 3);
    this.density = new Float32Array(this.size);
    this.nextDensity = new Float32Array(this.size);
    this.target = new Float32Array(this.size * 3);
    this.condensation = new Float32Array(this.size);
    this.updateForcing();
    for (let i = 0; i < this.size; i++) {
      const u = this.target[i*3], v = this.target[i*3+1], w = this.target[i*3+2];
      for (let q = 0; q < 19; q++) {
        const cu = CX[q]*u + CY[q]*v + CZ[q]*w;
        this.f[i*19+q] = W[q] * (1 + 3*cu + 4.5*cu*cu - 1.5*(u*u+v*v+w*w));
      }
      this.density[i] = this.condensation[i];
    }
  }

  private updateForcing() {
    const { nx, ny, nz, parameters: p } = this;
    const t = this.iteration * 0.013;
    for (let z = 0; z < nz; z++) {
      const h = z / (nz - 1);
      const bendX = (Math.sin(h*5 + t*.35) - Math.sin(t*.35)) * .075 * h;
      const bendY = Math.sin(h*4 - t*.24) * .055 * h;
      const core = (.095 + .23 * h*h + .12*Math.pow(h, 8)) * p.radius;
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const i = x + nx*(y + ny*z);
        const dx = (x/(nx-1)-.5)*2 - bendX;
        const dy = (y/(ny-1)-.5)*2 - bendY;
        const r = Math.sqrt(dx*dx+dy*dy) + .0001;
        const a = Math.atan2(dy, dx);
        const edge = clamp((.96-r)/.18, 0, 1);
        const spin = .085 * p.swirl * (2*r*core/(r*r + core*core)) * edge;
        const inflow = -.025 * p.updraft * Math.exp(-h*4) * edge;
        const perturb = .008*p.turbulence*Math.sin(a*3+h*21-t)*Math.sin(h*13+t*.7);
        this.target[i*3] = -dy/r*spin + dx/r*inflow + perturb;
        this.target[i*3+1] = dx/r*spin + dy/r*inflow - perturb;
        this.target[i*3+2] = .07*p.updraft*Math.exp(-r*r/(core*core*3)) * clamp(h*18, 0, 1);

        // Condensation keeps a thin, coherent funnel; the scalar still evolves
        // through the LBM velocity, dissipation and continuously supplied dust.
        const corrugation = 1 + .12*p.turbulence*Math.sin(3*a - h*28 + t*2);
        const rr = r / (core*corrugation);
        const shell = Math.exp(-Math.pow((rr-.65)/.65, 2));
        const topFade = clamp((.98-h)*10, 0, 1);
        const funnel = shell * .95 * topFade;
        const dust = Math.exp(-r*r/.13)*Math.exp(-h*28)*.9;
        const crown = Math.exp(-Math.pow((h-.85)/.095, 2))*Math.exp(-r*r/.28)*.7*topFade;
        const grain = .8 + .2*Math.sin(x*1.7+y*.8+z*1.3);
        this.condensation[i] = clamp((funnel+dust+crown)*grain*edge, 0, 1);
      }
    }
  }

  step() {
    const { nx, ny, nz, size, f, next, velocity, target, populations: g } = this;
    if (this.iteration % 4 === 0) this.updateForcing();
    const omega = 1 / .64; // nu = (tau - 0.5) / 3; safely above tau=0.5.
    let maximum = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx*(y + ny*z), offset = i*19;
      let rho = 0, ux = 0, uy = 0, uz = 0;
      for (let q = 0; q < 19; q++) {
        const sx = x-CX[q], sy = y-CY[q], sz = z-CZ[q];
        // Ground: no-slip bounce-back. Sides/top: equilibrium reservoir (rho=1).
        const value = sz < 0 ? f[offset+opposite(q)]
          : sx < 0 || sy < 0 || sz >= nz || sx >= nx || sy >= ny ? W[q]
          : f[(sx+nx*(sy+ny*sz))*19+q];
        g[q] = value;
        rho += value; ux += CX[q]*value; uy += CY[q]*value; uz += CZ[q]*value;
      }
      // Invalid cells are surfaced, never silently shown as a successful solve.
      if (!Number.isFinite(rho) || rho <= 0) throw new Error('LBM became unstable. Reset the simulation.');
      ux /= rho; uy /= rho; uz /= rho;
      const strength = .032;
      const fx = rho * strength * (target[i*3]-ux);
      const fy = rho * strength * (target[i*3+1]-uy);
      const fz = rho * strength * (target[i*3+2]-uz);
      ux += fx/(2*rho); uy += fy/(2*rho); uz += fz/(2*rho);
      const u2 = ux*ux+uy*uy+uz*uz;
      maximum = Math.max(maximum, u2);
      velocity[i*3] = ux; velocity[i*3+1] = uy; velocity[i*3+2] = uz;
      for (let q = 0; q < 19; q++) {
        const cu = CX[q]*ux+CY[q]*uy+CZ[q]*uz;
        const cf = CX[q]*fx+CY[q]*fy+CZ[q]*fz;
        const equilibrium = W[q]*rho*(1+3*cu+4.5*cu*cu-1.5*u2);
        const force = W[q]*(1-.5*omega)*(3*(cf-(ux*fx+uy*fy+uz*fz))+9*cu*cf);
        next[offset+q] = g[q] + omega*(equilibrium-g[q]) + force;
      }
    }
    this.f = next; this.next = f;
    this.maxSpeed = Math.sqrt(maximum);
    const scalar = this.density, output = this.nextDensity;
    for (let i = 0; i < size; i++) {
      const x = i % nx, y = Math.floor(i/nx)%ny, z = Math.floor(i/(nx*ny));
      const sx = clamp(x - velocity[i*3]*3, 0, nx-1.001);
      const sy = clamp(y - velocity[i*3+1]*3, 0, ny-1.001);
      const sz = clamp(z - velocity[i*3+2]*3, 0, nz-1.001);
      const x0 = Math.floor(sx), y0 = Math.floor(sy), z0 = Math.floor(sz);
      const tx = sx-x0, ty = sy-y0, tz = sz-z0;
      const b = x0+nx*(y0+ny*z0), layer = nx*ny;
      const c00 = scalar[b]*(1-tx)+scalar[b+1]*tx;
      const c10 = scalar[b+nx]*(1-tx)+scalar[b+nx+1]*tx;
      const c01 = scalar[b+layer]*(1-tx)+scalar[b+layer+1]*tx;
      const c11 = scalar[b+layer+nx]*(1-tx)+scalar[b+layer+nx+1]*tx;
      const advected = (c00*(1-ty)+c10*ty)*(1-tz)+(c01*(1-ty)+c11*ty)*tz;
      output[i] = clamp(advected*.975 + this.condensation[i]*.025, 0, 1);
    }
    this.density = output; this.nextDensity = scalar;
    this.iteration++;
  }

  /** z slices packed in a 2D atlas; half-texel addressing avoids slice bleeding. */
  toAtlas(): Uint8Array {
    const columns = Math.ceil(Math.sqrt(this.nz));
    const rows = Math.ceil(this.nz / columns);
    const width = columns * this.nx;
    const result = new Uint8Array(width * rows * this.ny * 4);
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const src = x + this.nx*(y+this.ny*z);
      const dst = ((z%columns)*this.nx+x + width*(Math.floor(z/columns)*this.ny+y))*4;
      result[dst] = Math.round(this.density[src]*255);
      result[dst+3] = 255;
    }
    return result;
  }

  diagnostics() {
    let min = Infinity, max = -Infinity, mass = 0;
    for (let i = 0; i < this.size; i++) {
      let rho = 0;
      for (let q = 0; q < 19; q++) rho += this.f[i*19+q];
      min = Math.min(min, rho); max = Math.max(max, rho); mass += rho;
    }
    return { minDensity: min, maxDensity: max, meanDensity: mass/this.size, maxSpeed: this.maxSpeed };
  }
}
