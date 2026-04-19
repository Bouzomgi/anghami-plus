import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export class AnghamiPlusStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const apiSecret = this.node.tryGetContext('apiSecret') as string | undefined;
    if (!apiSecret) throw new Error('Required: cdk deploy -c apiSecret=<value>');

    const fn = new lambdaNodejs.NodejsFunction(this, 'ProxyFunction', {
      functionName: 'anghami-plus-proxy',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../src/handler/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: { API_SECRET: apiSecret },
    });

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
        ],
      })
    );

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type', 'X-Api-Secret'],
      },
    });

    new cdk.CfnOutput(this, 'FunctionUrl', { value: fnUrl.url });
  }
}
