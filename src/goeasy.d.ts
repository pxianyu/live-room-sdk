declare module 'goeasy' {
  const GoEasy: {
    getInstance(options: {
      host: string;
      appkey: string;
      modules: ['pubsub'];
    }): unknown;
  };

  export default GoEasy;
}
