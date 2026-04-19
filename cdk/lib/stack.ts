import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

const SSM_SECRET_PATH = '/anghami-plus/api-secret';

export class AnghamiPlusStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fn = new lambdaNodejs.NodejsFunction(this, 'ProxyFunction', {
      functionName: 'anghami-plus-proxy',
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../src/handler/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      environment: { SSM_SECRET_PATH },
    });

    // Lambda reads the secret from SSM at runtime
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter${SSM_SECRET_PATH}`,
        ],
      })
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` },
        },
      })
    );

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
