/** Standalone filters consume their decoded value literally, including quote characters. */
export function postgrestScalarValue(value:string){
  return encodeURIComponent(value);
}

/** Nested or/and expressions need a quoted value to protect their grammar delimiters. */
export function postgrestLogicValue(value:string){
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}
