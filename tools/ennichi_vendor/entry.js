// 緣日樂園的 three.js 擴充：依附在全站共用的 vendor/three.min.js（r149，全域 THREE）上。
// 範例模組（examples/jsm）一律取 three@0.149.0 的同版本，避免和 three.min.js 版本不合。
import { GLTFLoader } from "three149/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three149/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three149/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three149/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three149/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three149/examples/jsm/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three149/examples/jsm/shaders/GammaCorrectionShader.js";
import * as BufferGeometryUtils from "three149/examples/jsm/utils/BufferGeometryUtils.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

window.PriTestEnnichiVendor = {
  GLTFLoader: GLTFLoader,
  OrbitControls: OrbitControls,
  EffectComposer: EffectComposer,
  RenderPass: RenderPass,
  UnrealBloomPass: UnrealBloomPass,
  ShaderPass: ShaderPass,
  GammaCorrectionShader: GammaCorrectionShader,
  BufferGeometryUtils: BufferGeometryUtils,
  VRMLoaderPlugin: VRMLoaderPlugin,
  VRMUtils: VRMUtils,
};
